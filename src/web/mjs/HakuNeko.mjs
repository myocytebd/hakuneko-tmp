import InterProcessCommunication from './engine/InterProcessCommunication.mjs';
import Enums from './engine/Enums.mjs';
import Connector from './engine/Connector.mjs';

import Blacklist from './engine/Blacklist.mjs';
import BookmarkImporter from './engine/BookmarkImporter.mjs';
import BookmarkManager from './engine/BookmarkManager.mjs';
import ChaptermarkManager from './engine/ChaptermarkManager.mjs';
import Connectors from './engine/Connectors.mjs';
import DownloadManager from './engine/DownloadManager.mjs';
//import HistoryWorker from './engine/HistoryWorker.mjs'
import Request from './engine/Request.mjs';
import Settings from './engine/Settings.mjs';
import Storage from './engine/Storage.mjs';
import Version from './VersionInfo.mjs';
import DiscordPresence from './engine/DiscordPresence.mjs';

export default class HakuNeko {

    constructor(context) {
        // set global first, beause some of the engine classes access them during instantiation
        this._initializeGlobals(context);

        this._version = Version;
        this._enums = Enums;

        let ipc = new InterProcessCommunication();
        this._blacklist = new Blacklist();
        this._downloadManager = new DownloadManager();
        this._settings = new Settings();
        this._request = new Request(ipc, this._settings);
        this._connectors = new Connectors(ipc);
        this._storage = new Storage();
        this._bookmarkManager = new BookmarkManager(this._settings, new BookmarkImporter());
        this._chaptermarkManager = new ChaptermarkManager(this._settings);
        this._discordPresence = new DiscordPresence(this._settings);
    }

    /**
     * Backward compatibility to expose various members and classes as globals to the given context.
     * This is required because the UI elements acess these globals directly instead of the engine.
     * @param context
     */
    _initializeGlobals(context) {
        // TODO: remove backward compatibility for global aliases when all their references are set to HakuNeko engine

        // required by various frontend and engine components
        context.EventListener = Enums.EventListener;

        // required in frontend/bookmarks.html
        context.Connector = Connector;
    }

    async initialize() {
        document.addEventListener('keyup', this.onKeyUp.bind(this));
        await this._connectors.initialize();
    }

    get Blacklist() {
        return this._blacklist;
    }

    get BookmarkManager() {
        return this._bookmarkManager;
    }

    get ChaptermarkManager() {
        return this._chaptermarkManager;
    }

    get Connectors() {
        return this._connectors.list;
    }

    get DownloadManager() {
        return this._downloadManager;
    }

    get Enums() {
        return this._enums;
    }

    get Request() {
        return this._request;
    }

    get Settings() {
        return this._settings;
    }

    get Storage() {
        return this._storage;
    }

    get Version() {
        return this._version;
    }

    onKeyUp(event) {
        console.log(`onKeyUp: key=${event.key}, ctrl=${event.ctrlKey}`);
        let hakunekoAppUI = document.querySelector('hakuneko-app');
        if (event.key === 'v' && event.ctrlKey) {
            if (document.hasFocus() && document.activeElement === document.body) {
                hakunekoAppUI.shadowRoot.querySelector('hakuneko-mangas').onPasteClick(event);
            }
        }
    }

    HakunekoManga$onDownloadMangasClick(hakunekoMangasUI) {
        console.log('onDownloadMangasClick');
        if (!hakunekoMangasUI.mangaList || hakunekoMangasUI.mangaList.length < 1)
            return;
        let mangaList = Array.from(hakunekoMangasUI.shadowRoot.querySelectorAll('ul.list li.manga.available')).map(elem => elem.__templatizeInstance.item);
        if (mangaList.length < 1)
            return;
        let managListDesc = `[${mangaList.length}]: ${mangaList[0]}`;
        let statusID = hakunekoMangasUI.$.status.addToQueue(`Batch loading manga list for download (${managListDesc})`);
        Connector.batchDownload(mangaList, (manga, state) => {
            let hakunekoChapters = hakunekoMangasUI.parentElement.querySelector('hakuneko-chapters');
            if (manga !== null) {
                // Chapter loaded for a manga
                if (manga === hakunekoChapters.selectedManga && (!hakunekoChapters.chapterList || hakunekoChapters.chapterList.length < 1)) {
                    hakunekoChapters.onSelectedMangaChanged(manga);
                }
            } else {
                // All done
                hakunekoMangasUI.$.status.removeFromQueue(statusID);
            }
        });
    }
}
