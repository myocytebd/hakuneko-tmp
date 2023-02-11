import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

const WorkCategory = {
    illust: 'illust',
    manga: 'manga',
    // ugoira: 'ugoira',
    // novel: 'novel',
};
WorkCategory.all = [ WorkCategory.illust, WorkCategory.manga ];

const kUser = 'user', kArtwork = 'artwork', kSeries = 'series';
// const enableTrace = true;

// Let artwork => chapter; series => manga; artwork without series => placeholder manga
export default class Pixiv extends Connector {

    constructor() {
        super();
        this.id = 'pixiv';
        this.label = 'pixiv (Artwork)';
        this.tags = [ 'manga', 'japanese' ];
        this.url = 'https://www.pixiv.net';
        this.links = {
            login: 'https://accounts.pixiv.net/login'
        };
        this.config = {
            storage: {
                preserveServerPageFileName: true,
                unaliasChapterFolderNameById: true,
            }
        };
        this.apiURL = 'https://www.pixiv.net/ajax/';
        this.requestOptions.headers.set('x-referer', this.url);
    }

    async _getMangaFromURI(uri) {
        let uriInfo = this.parseURI(uri);
        if (uriInfo.type === kSeries) {
            let { seriesId } = uriInfo;
            return await this.createMangaFromSeries(seriesId);
        } else if (uriInfo.type === kArtwork) {
            const { artworkId } = uriInfo;
            const artworkInfo = await this.fetchArtworkInfo(artworkId);
            if (artworkInfo.body.seriesNavData && artworkInfo.body.seriesNavData.seriesId) {
                return await this.createMangaFromSeries(artworkInfo.body.seriesNavData.seriesId);
            } else {
                return this.createMangaFromArtworkInfo(artworkInfo, artworkId);
            }
        } else if (uriInfo.type === kUser) {
            return this.getMangasFromUserPages(uriInfo, -1);
        } else {
            throw new Error('Provided link doesn\'t contain manga series or artwork!');
        }
    }

    async _getMangas() {
        let msg = 'This website does not provide a manga list, please copy and paste the URL containing the chapters directly from your browser into HakuNeko.';
        throw new Error(msg);
    }

    async _getChapters(manga) {
        let chapterList = [];
        if (manga.id.startsWith('artwork-')) {
            chapterList.push({
                id: manga.id.match(/artwork-(\d+)/)[1],
                title: manga.title
            });
        } else {
            const kChaptersPerPageDefault = 12;
            let promises = [];
            let chapterCount = this.findActualSeriesInfoFromManga(manga).total;
            let pageStart = 1, pageEnd = 1 + Math.floor(chapterCount / kChaptersPerPageDefault);
            let exit_loop = false; // In order to make Lint happy
            while (!exit_loop) {
                for (let page = pageStart; page <= pageEnd; page++) {
                    promises.push(this._getChaptersFromPage(manga.id, page));
                }
                let chapterPageResults = await Promise.allSettled(promises);
                let noMoreResults = false;
                for (let [ index, chapterPageResult ] of chapterPageResults.entries()) {
                    if (chapterPageResult.reason) {
                        console.error(`${this.id}: failed to fetch chapters: ${manga} / ${pageStart + index}:`, chapterPageResult.reason);
                    } else {
                        chapterList.push(...chapterPageResult.value);
                        if (index === chapterPageResults.length - 1 && chapterPageResult.value.length === 0) {
                            noMoreResults = true;
                        }
                    }
                }
                if (chapterList.length >= chapterCount || noMoreResults === 0) {
                    exit_loop = true;
                    continue;
                } else {
                    pageStart = pageEnd + 1;
                    pageEnd = pageStart + 1;
                }
            }
        }
        return chapterList;
    }

    async _getChaptersFromPage(mangaId, page) {
        const uri = new URL(`series/${mangaId}?p=${page}&lang=en`, this.apiURL);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request);
        let chapterListFromPage = [];
        data.body.page.series.forEach(chapter => {
            const chapterContents = data.body.thumbnails.illust.find(c => c.id === chapter.workId);
            if (chapterContents) {
                chapterListFromPage.push({
                    id: chapterContents.id,
                    title: chapterContents.title.trim()
                });
            }
        });
        return chapterListFromPage;
    }

    async _getPages(chapter) {
        const uri = new URL(`illust/${chapter.id}/pages?lang=en`, this.apiURL);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request);
        return data.body.map(image => this.createConnectorURI(image.urls.original));
    }

    _getMangaOutputPath(manga) {
        return [ `${manga.__authorInfo.userId}_${manga.__authorInfo.userName}`, manga.title ];
    }

    async getMangasFromUserPages(uriInfo, fetchLimit) {
        const kArtworksPerApi = 48;
        if (fetchLimit === undefined || fetchLimit <= 0) fetchLimit = 1000;
        const userId = uriInfo.userId;
        const artworkTypes = [ uriInfo.artworkType ].flat();
        const userInfo = await this.fetchUserInfo(userId);
        const mangas = [], mangaMap = new Map, seriesMap = new Map;
        let mangaPromises = [];
        async function trackMangaFetch(promise, sourceInfo) {
            promise.sourceInfo = sourceInfo;
            mangaPromises.push(promise);
        }
        const seriesIdInMap = (seriesId) => `s${seriesId}`;
        const addMangaSeries = async (seriesId, artworkTypesFilter) => {
            seriesMap.set(seriesId, {});
            let manga = await this.createMangaFromSeries(seriesId);
            if (mangaMap.get(seriesIdInMap(seriesId)) !== undefined) {
                console.warn(`${this.id}: duplicated artwork (from series) ??? ${manga.id}: ${manga.title}`);
                return;
            }
            if (artworkTypesFilter.indexOf(WorkCategory.manga) >= 0)
                mangas.push(manga);
            mangaMap.set(seriesIdInMap(seriesId), manga);
            seriesMap.set(seriesId, manga.__seriesInfo);
            // Register belonging manga artworks
            let chapters = await this._getChapters(manga);
            for (let chapter of chapters)
                mangaMap.set(chapter.id, manga);
        };
        // user/[id]/profile/illusts does not contain series info
        const addArtworkFromBrief = (artworkBrief, artworkId) => {
            if (mangaMap.get(artworkId) !== undefined) {
                console.warn(`${this.id}: duplicated artwork (from non-series) ??? ${manga.id}: ${manga.title}`);
                return;
            }
            let manga = this.createMangaFromArtworkBrief(artworkBrief, artworkId);
            mangas.push(manga);
            mangaMap.set(artworkId, manga);
        };
        const addArtworksFromBrief = async (artworkIds, artworkType) => {
            const artworksBrief = await this.fetchArtworksBrief(userId, artworkIds, artworkType);
            for (let artworkId of artworkIds) {
                const artworkBrief = artworksBrief.body.works[artworkId];
                if (artworkBrief === undefined) {
                    console.error(`${this.id}: failed to fetch artwork brief: ${artworkId}: missing in response`);
                    continue;
                }
                addArtworkFromBrief(artworkBrief, artworkId);
            }
        };
        const runMangaFetches = async () => {
            let mangaResults = await Promise.allSettled(mangaPromises);
            for (let [ i, mangaResult ] of mangaResults.entries() ) {
                if (mangaResult.reason) {
                    if (mangaPromises[i].sourceInfo.type === kSeries) {
                        console.error(`${this.id}: failed to fetch series ${mangaPromises[i].sourceInfo.seriesBrief.id} / ${mangaPromises[i].sourceInfo.seriesBrief.title}: `, mangaResult.reason);
                    } else {
                        console.error(`${this.id}: failed to fetch artwork ${mangaPromises[i].sourceInfo.batchArtworkIds[0]} ... : `, mangaResult.reason);
                    }
                }
            }
        };
        // Scrape series first.
        const seriesBriefList = userInfo.body.mangaSeries;
        for (let seriesBrief of seriesBriefList) {
            trackMangaFetch(addMangaSeries(seriesBrief.id, artworkTypes), { type: kSeries, seriesBrief: seriesBrief });
        }
        await runMangaFetches();
        mangaPromises = [];
        // Scrape non-series artworks.
        for (let artworkType of artworkTypes) {
            let artworkIds;
            switch(artworkType) {
                case WorkCategory.illust: artworkIds = Object.keys(userInfo.body.illusts); break;
                case WorkCategory.manga: artworkIds = Object.keys(userInfo.body.manga); break;
                default: continue;
            }
            const nonSeriesArtworkIds = artworkIds.filter(artworkId => !mangaMap.has(artworkId));
            for (let i = 0; i < nonSeriesArtworkIds.length; i += kArtworksPerApi) {
                const batchArtworkIds = nonSeriesArtworkIds.slice(i, i + kArtworksPerApi);
                trackMangaFetch(addArtworksFromBrief(batchArtworkIds), { type: kArtwork, batchArtworkIds });
            }
        }
        await runMangaFetches();
        return mangas;
    }

    parseURI(uriOrInfoOrString) {
        if (typeof uriOrInfoOrString === 'string') {
            return this.parseURI(new URL(uriOrInfoOrString, this.url));
        } else if (!(uriOrInfoOrString instanceof URL)) {
            return uriOrInfoOrString;
        }
        const uri = uriOrInfoOrString;
        const defaultInfo = { type: null, uri };
        let match;
        if ((match = uri.pathname.match(`/users/([0-9]+)(/*)([a-z]*)`)) !== null) {
            const userId = match[1];
            let artworkType;
            switch (match[3]) {
                case 'illustrations': artworkType = WorkCategory.illust; break;
                case 'manga': artworkType = WorkCategory.manga; break;
                case '': // Fall through
                case 'artworks': artworkType = WorkCategory.all; break;
                default: return defaultInfo;
            }
            let pageNum = parseInt(uri.searchParams.get('p')) || 1;
            return { type: kUser, userId, artworkType, pageNum, uri };
        } else if ((match = uri.pathname.match(`/series/(\\d+)`)) !== null) {
            const seriesId = match[1];
            return { type: kSeries, seriesId, uri };
        } else if ((match = uri.pathname.match(`/artworks/(\\d+)`)) !== null) {
            const artworkId = match[1];
            return { type: kArtwork, artworkId, uri };
        }
        return defaultInfo;
    }

    async fetchUserInfo(userId) {
        const request = new Request(new URL(`user/${userId}/profile/all`, this.apiURL), this.requestOptions);
        const userInfo = this.fetchJSON(request);
        userInfo.__source = { userId };
        return userInfo;
    }

    async fetchArtworkInfo(artworkId) {
        const request = new Request(new URL(`illust/${artworkId}?lang=en`, this.apiURL), this.requestOptions);
        const artworkInfo = await this.fetchJSON(request);
        artworkInfo.__source = { artworkId };
        return artworkInfo;
    }

    async fetchArtworksBrief(userId, artworkIdOrArray, artworkType) {
        let artworkIds = Array.isArray(artworkIdOrArray) ? artworkIdOrArray : [ artworkIdOrArray ];
        if (artworkIds.length === 0) return null;
        let uri = new URL(`user/${userId}/profile/illusts`, this.apiURL);
        for (let artworkId of artworkIds) {
            uri.searchParams.append('ids[]', artworkId);
        }
        uri.searchParams.set('work_category', artworkType);
        uri.searchParams.set('is_first_page', '1');
        const request = new Request(uri, this.requestOptions);
        const artworksBriefInfo = this.fetchJSON(request);
        artworksBriefInfo.__source = { userId, artworkType };
        return artworksBriefInfo;
    }

    async fetchSeriesInfo(seriesId, pageNum) {
        const request = new Request(new URL(`series/${seriesId}?p=${pageNum}&lang=en`, this.apiURL), this.requestOptions);
        const seriesInfo = await this.fetchJSON(request);
        seriesInfo.__source = { seriesId, pageNum, url: seriesInfo.body.extraData.meta.canonical };
        return seriesInfo;
    }

    findActualSeriesInfo(seriesInfo, seriesId) {
        return seriesInfo.body.illustSeries.find(s => s.id === seriesId);
    }

    findActualSeriesInfoFromManga(manga) {
        return this.findActualSeriesInfo(manga.__seriesInfo, manga.__seriesInfo.__source.seriesId);
    }

    async createMangaFromSeries(seriesId) {
        const seriesInfo = await this.fetchSeriesInfo(seriesId, 1);
        let manga = new Manga(this, seriesId, this.findActualSeriesInfo(seriesInfo, seriesId).title.trim());
        manga.__seriesInfo = seriesInfo;
        manga.__authorInfo = { userId: seriesInfo.body.users[0].userId, userName: seriesInfo.body.users[0].name };
        return manga;
    }

    createMangaFromArtworkInfo(artworkInfo, artworkId) {
        const title = artworkInfo.body.illustTitle.trim();
        let manga = new Manga(this, `artwork-${artworkId || artworkInfo.__source.artworkId}`, title);
        manga.__seriesInfo = null;
        manga.__authorInfo = { userId: artworkInfo.body.userId, userName: artworkInfo.body.userName };
        return manga;
    }

    createMangaFromArtworkBrief(artworkBrief, artworkId) {
        const title = artworkBrief.title.trim();
        let manga = new Manga(this, `artwork-${artworkId}`, title);
        manga.__seriesInfo = null;
        manga.__authorInfo = { userId: artworkBrief.userId, userName: artworkBrief.userName };
        return manga;
    }
}
