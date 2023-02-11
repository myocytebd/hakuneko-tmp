import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

const kSearch = 'search', kManga = 'manga', kChapter = 'chapter', kAuthor = 'author', kResPage = 'page';
const kSearchPageSize = 30;
const enableProfiling = true, enableTrace = true;
function wrapAsyncProfiling(fn, argsDescFn, desc) {
    desc = desc || fn.name;
    return async function ayncProfilingWrapper(...args) {
        let startTime = performance.now();
        let rv = await fn.apply(this, args);
        let ellapsed = performance.now() - startTime;
        if (enableProfiling) {
            let argsDesc = argsDescFn ? argsDescFn(...args) : args.join(',');
            console.log(`async-profiling: ${desc}: took ${ellapsed} ms: ${argsDesc}`);
        }
        return rv;
    };
}

export default class JComic extends Connector {

    constructor() {
        super();
        super.id = 'jcomic_net';
        super.label = 'JComic.net';
        this.tags = [ 'hentai', 'chinese' ];
        this.url = 'https://jcomic.net';
        this.config = {
            storage: {
                preserveServerPageExtName: true,
            }
        };
        this.requestOptions.headers.set('x-referer', this.url);
        this.fetchDOMWrap = wrapAsyncProfiling(this.fetchDOM, (...args) => `${args[0]} ${decodeURI(args[0].url)}`);
        // console.log(this);
    }

    canHandleURI(uri) {
        return this.parseURI(uri).type !== null;
    }

    async _getMangaFromURI(uri) {
        let uriInfo = this.parseURI(uri);
        if (uriInfo.type === kManga || uriInfo.type === kChapter) {
            return this.getMangaFromMangaOrChapterURI(uriInfo);
        } else if (uriInfo.type === kSearch) {
            return this.getMangasFromSearchResultURI(uriInfo);
        } else if (uriInfo.type == kAuthor) {
            return this.getMangasFromAuthorURI(uriInfo);
        } else {
            throw new Error('Unrecognized URL');
        }
    }

    async _getMangas() {
        let msg = 'This website does not provide a manga list, please copy and paste the URL containing the images directly from your browser into HakuNeko.';
        throw new Error(msg);
    }

    async _getChapters(manga) {
        if (enableTrace) console.log('_getChapters', manga.uriInfo);
        let uriInfo = manga.uriInfo;
        let request = new Request(uriInfo.uri, this.requestOptions);
        let aNodes = await this.fetchDOMWrap(request, 'div.row.col-md-6.col-xs-12 a', 3);
        let chapters = [];
        let chapterCount = -1;
        for (let a of Array.from(aNodes)) {
            let chapterURIInfo = this.parseURI(new URL(a.getAttribute('href'), manga.uriInfo.uri));
            if (chapterURIInfo.type !== kChapter) continue;
            var chapterButton = a.querySelector('button');
            if (!chapterButton) continue;
            var title = chapterButton.textContent;
            chapters.push({ id: decodeURI(chapterURIInfo.uri.toString()), title, language: '' });
            chapterCount = Math.max(chapterCount, chapterURIInfo.index);
        }
        manga.chapterCount = chapterCount;
        return chapters;
    }

    async _getPages(chapter) {
        let chapterURL = chapter.id;
        let request = new Request(chapterURL, this.requestOptions);
        let imgNodes = await this.fetchDOMWrap(request, 'source.lazy.comic-view');
        let pages = [];
        for (let img of imgNodes) {
            // e.g. https://data.jcomic.net/file/jcomic-asset/63dd50a586b65f45700fef79/1/1.jpg
            let pageURIInfo = this.parseURI(img.getAttribute('data-original'));
            if (pageURIInfo.type !== kResPage) continue;
            pages.push(pageURIInfo.uri.toString());
        }
        return pages;
    }

    parseURI(uriOrInfo) {
        if (typeof uriOrInfo === 'string') {
            return this.parseURI(new URL(uriOrInfo));
        } else if (!(uriOrInfo instanceof URL)) {
            return uriOrInfo;
        }
        let uri = uriOrInfo;
        // This site do not encode URL -- some links contain '?' and cannot be directly visited.
        // Try to fix URL. (This site has no search params)
        let pathname = decodeURIComponent(uri.pathname) + decodeURIComponent(uri.search);
        let pathSegs = pathname.split('/').slice(1); // Remove 1st empty entry
        let fixedPathname = '/' + pathSegs.map(pathSeg => encodeURIComponent(pathSeg)).join('/');
        uri = new URL(fixedPathname, uri);
        let emptyInfo = { type: null, content: pathname, index: -1, uri };
        if (uri.host === 'jcomic.net') {
            // https://jcomic.net/search/<keywords>[/N]
            // https://jcomic.net/eps/<title>[/N]
            // https://jcomic.net/page/<title>[/N]
            // https://jcomic.net/author/<author>
            let content = pathSegs[1] || '';
            // No page number => page 1
            let index = pathSegs[2] === undefined ? 1 : (parseInt(pathSegs[2]) || -1);
            let d = { pathname };
            if (pathSegs[0] == 'search') {
                return { type: kSearch, content, index, uri, d };
            } else if (pathSegs[0] == 'eps') {
                return { type: kManga, content, index, uri, d };
            } else if (pathSegs[0] == 'page') {
                return { type: kChapter, content, index, uri, d };
            } else if (pathSegs[0] == 'author') {
                return { type: kAuthor, content, index, uri, d };
            }
        } else if (uri.host === 'data.jcomic.net') {
            // https://data.jcomic.net/file/jcomic-asset/63dd50a586b65f45700fef79/1/1.jpg
            let content = `${pathSegs[2]}/${pathSegs[3]}`;
            let index = parseInt(pathSegs[4]) || -1;
            let node = new URL(`/${pathSegs[0]}/${pathSegs[1]}`, uri);
            let extra = { node: node, file: pathSegs[4] };
            return { type: kResPage, content, index, uri, extra };
        }
        return emptyInfo;
    }

    composePageURIFromURI(uriOrInfo, index) {
        let pathSegs = uriOrInfo.d.pathname.split('/');
        if (pathSegs[3] === undefined) pathSegs.push('1');
        return this.parseURI(new URL(pathSegs.slice(0, -1).concat(index).join('/'), uriOrInfo.uri));
    }

    composeMangaURIFromOtherURI(uriOrInfo) {
        let uriInfo = this.parseURI(uriOrInfo);
        if (uriInfo.type === kManga) {
            return uriInfo;
        } else if (uriInfo.type === kChapter) {
            let pathSegs = uriInfo.d.pathname.split('/');
            pathSegs[1] = 'eps';
            return this.parseURI(new URL(pathSegs.join('/'), uriInfo.uri));
        } else {
            return null;
        }
    }

    getMangaFromMangaOrChapterURI(uriOrInfo) {
        let uriInfo = this.parseURI(uriOrInfo);
        let id = uriInfo.content;
        let title = uriInfo.content.trim();
        let manga = new Manga(this, id, title);
        manga.uriInfo = this.composeMangaURIFromOtherURI(uriInfo);
        manga.chapterCount = -1;
        if (enableTrace) {
            console.log('getMangaFromMangaURI: from: ', uriInfo);
            console.log('getMangaFromMangaURI: as: ', manga.uriInfo);
        }
        return manga;
    }

    async getMangasFromSearchResultURI(uriOrInfo) {
        return this.getMangasFromMultiPageURI(uriOrInfo);
    }

    async getMangasFromAuthorURI(uriOrInfo) {
        return this.getMangasFromMultiPageURI(uriOrInfo);
    }

    async getMangasFromMultiPageURI(uriOrInfo) {
        const kFetchPageLimit = 5;
        const rkSearchSummaryRegexPattern = /搜尋:(.*)找到([0-9]+)本相關本子/;
        let uriInfo = this.parseURI(uriOrInfo);
        if (uriInfo.index < 0) return [];
        let mangas = [];
        let request = new Request(uriInfo.uri, this.requestOptions);
        let dom0 = await this.fetchDOMWrap(request, null, 3);
        let mangaCount = -1, pageCount = -1;
        if (uriInfo.type === kSearch) {
            let searchSummaryNode = Array.from(dom0.querySelectorAll('div.container div p')).find(p => rkSearchSummaryRegexPattern.test(p.textContent));
            if (searchSummaryNode) {
                mangaCount = parseInt(searchSummaryNode.textContent.match(rkSearchSummaryRegexPattern)[2]);
            }
        }
        if (dom0.querySelector('div.container ul.pagination')) {
            let pageLinkNodes = Array.from(dom0.querySelectorAll('div.container ul.pagination li a'));
            if (pageLinkNodes.length > 0) {
                let lastPageLinkNode = pageLinkNodes[pageLinkNodes.length - 1 - (pageLinkNodes[pageLinkNodes.length - 1].textContent.indexOf('»') >= 0 ? 1 : 0)];
                if (lastPageLinkNode)
                    pageCount = this.parseURI(new URL(lastPageLinkNode.getAttribute('href'), uriInfo.uri)).index;
            }
        } else {
            pageCount = 1;
        }
        if (mangaCount >= 0 && pageCount < 0)
            pageCount = Math.ceil(mangaCount / kSearchPageSize);
        let pagePromises = [];
        for (let pageNum = uriInfo.index + 1; pageNum < uriInfo.index + kFetchPageLimit && (pageNum <= pageCount || pageCount < 0); pageNum++) {
            let pageURIInfo = this.composePageURIFromURI(uriOrInfo, pageNum);
            let request = new Request(pageURIInfo.uri, this.requestOptions);
            let promise = this.fetchDOMWrap(request, null, 3);
            promise.uriInfo = pageURIInfo;
            pagePromises.push(promise);
        }
        let pagesResult = await Promise.allSettled(pagePromises);
        let pagesDom = [ dom0 ];
        for (let [ i, pageResult ] of pagesResult.entries()) {
            if (!pageResult.value) {
                console.error(`${this.id}: failed to fetch search/author result page: ${pagePromises[i].uriInfo.uri}: `, pageResult.reason);
                continue;
            }
            pagesDom.push(pageResult.value);
        }
        for (let dom of pagesDom) {
            let mangaThumbNodes = dom.querySelectorAll('div.container a div.list-item');
            for (let mangaThumbNode of mangaThumbNodes) {
                mangas.push(this.getMangaFromMangaOrChapterURI(new URL(mangaThumbNode.parentElement.getAttribute('href'), uriInfo.uri)));
            }
        }
        return mangas;
    }
}