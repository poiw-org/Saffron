import Job from "../../components/job";
import Events from "../events";
import {JobStatus} from "../../components/JobStatus";
import Worker from "../workers";
import Config from "../../components/config";
import {nanoid} from "nanoid";
import Article from "../../components/articles";
import {ConfigOptions} from "../../middleware/ConfigOptions";
import Extensions from "../extensions";
import Source from "../../components/source";
import Scheduler from "../scheduler";
import * as ServerIO from "socket.io"
import * as ClientIO from "socket.io-client";


export default class Grid {

    private static instance: Grid
    private declare readonly isMain: boolean
    private declare readonly workersIds: string[];
    private declare workersClients: { workersIds: string[], socketId: string }[];
    private declare readonly encryptionKey: string

    private declare server: ServerIO.Server;
    private declare client: ClientIO.Socket;

    private constructor() {
        this.isMain = Config.getOption(ConfigOptions.SAFFRON_MODE) === 'main'
        this.workersIds = []
        this.workersClients = []
        this.encryptionKey = nanoid(256)

        if (this.isMain)
            this.server = new ServerIO.Server({
                // TODO
            });
        else
            this.client = ClientIO.io({
                // TODO
            });
    }

    /**
     * Returns an instance of Grid
     */
    static getInstance(): Grid {
        if (this.instance == null)
            this.instance = new Grid()

        return this.instance
    }

    emit(eventName: string, ...args: any[]): Promise<void> {
        return new Promise<void>(async resolve => {
            if (this.isMain) {
                if(['scheduler.job.push'].includes(eventName))
                    this.server.emit(eventName, ...args);
            }
            else {
                if(['workers.job.finished', 'workers.job.failed',
                    'grid.worker.announced', 'grid.worker.destroyed'].includes(eventName))
                    await this.client.emit(eventName, ...args);
            }
            resolve();
        })
    }

    /**
     * Connect to grid network.
     */
    async connect(): Promise<void> {
        if (this.isMain) {
            if (Config.getOption(ConfigOptions.GRID_DISTRIBUTED)) {
                this.server.on("connection", socket => {
                    Events.emit('grid.node.connected', socket);

                    socket.on("disconnect", () => {
                        Events.emit('grid.node.disconnected', socket);
                    });

                    socket.on("workers.job.finished", jobId => {
                        Scheduler.getInstance().changeJobStatus(jobId, JobStatus.FINISHED);
                    });

                    socket.on("workers.job.failed", jobId => {
                        Scheduler.getInstance().changeJobStatus(jobId, JobStatus.FAILED);
                    });

                    socket.on("grid.worker.announced", id => {
                        this.workersIds.push(id);
                    });

                    socket.on("grid.worker.destroyed", workerId => {
                        let index = this.workersIds.findIndex(id => id === workerId);
                        if (index !== -1) this.workersIds.splice(index, 1);
                    });
                });

                // await this.server.listen(); // TODO - listen with express
            }
        } else if (Config.getOption(ConfigOptions.WORKER_NODES) > 0) {
            this.client.on('connect', () => {
                for (const workerId of this.workersIds)
                    Events.emit("grid.worker.announced", workerId);
            });

            this.client.on('scheduler.job.push', (data: any) => {
                data.prototype = Job.prototype;
                Events.emit("scheduler.job.push", data);
            });

            await this.client.connect()
        }
    }

    /**
     * Return all connected workers' ids.
     * This function is used by the scheduler to access all the connected workers.
     */
    getWorkers(): string[] {
        return this.workersIds;
    }

    /**
     * <h1>Worker</h1>
     * Initialize a new worker on the grid
     * @param worker
     */
    announceWorker(worker: Worker): void {
        this.workersIds.push(worker.id)
        Events.emit("grid.worker.announced", worker.id);
    }

    /**
     * Remove a worker from the grid
     * @param worker
     */
    destroyWorker(worker: Worker): void {
        let index = this.workersIds.findIndex(id => id == worker.id)
        this.workersIds.splice(index, 1)
        Events.emit("grid.worker.destroyed", worker.id)
    }

    /**
     * Forcefully remove a worker from the grid
     * @param workerId
     */
    fireWorker(workerId: string): void {
        if (!this.isMain) return

        let index = this.workersClients.findIndex(js => {
            let index = js.workersIds.findIndex(id => id == workerId)
            return index !== -1;
        })

        if (index != -1) {
            let j = this.workersIds.findIndex((obj: string) => obj === workerId)
            if (j != -1) this.workersIds.splice(j, 1)

            let k = this.workersClients[index].workersIds.findIndex(id => workerId == id)
            if (k != -1) this.workersClients[index].workersIds.splice(k, 1)
        }

        let k = this.workersIds.findIndex(id => workerId == id)
        if (k != -1) this.workersIds.splice(k, 1)
    }

    /**
     * <h1>Worker</h1>
     * Flags the job as finished and update the grid
     * @param job
     */
    async finishedJob(job: Job): Promise<void> {
        job.status = JobStatus.FINISHED;
        if (this.isMain)
            Events.emit('workers.job.finished', job)
        else
            await this.client.emit('workers.job.finished', job.id);
    }

    /**
     * <h1>Worker</h1>
     * Flags the job as failed and update the grid
     * @param job
     */
    async failedJob(job: Job): Promise<void> {
        job.status = JobStatus.FAILED
        if (this.isMain)
            Events.emit("workers.job.failed", job)
        else
            await this.client.emit('workers.job.failed', {id: job.id})
    }

    /**
     * Will be called from both the main and sub programs
     * @param source
     * @param tableName
     * @param articles
     */
    async mergeArticles(source: Source, tableName: string, articles: Article[]): Promise<void> {
        Events.emit("workers.articles.found", articles, tableName); // Can be empty array
        if (articles.length == 0) return;

        articles.forEach(article => article.timestamp = Date.now());

        Events.emit("middleware.before", articles);

        let getExtPair = Extensions.getInstance().startCount();
        let pair: any;
        while ((pair = getExtPair()) != null) {
            if (pair.event === 'article.format') {
                for (const i in articles)
                    articles[i] = await pair.callback(articles[i]);
            } else if (pair.event === 'articles') {
                articles = await pair.callback(articles);
            }
        }

        Events.emit("middleware.after", articles);

        let dbArticles: Article[];
        try {
            dbArticles = await Config.getOption(ConfigOptions.DB_GET_ARTICLES)({tableName});
        } catch (e) {
            Events.emit("middleware.after", source, e);
            return;
        }

        // let urls: string[] = articles[0].getSource().instructions.url.map((url: string[]) => url[0]); // TODO
        // if(urls.length > 1) {
        //     for(const url of urls) {
        //         let dbArticles = await this.getArticles(src, {
        //             pageNo: 1,
        //             articlesPerPage: articles.length >= 5 ? articles.length * 2 : 10,
        //             filter: {}
        //         })
        //
        //
        //     }
        //
        //     return;
        // }

        // And then check if they already exist.
        let hashes = dbArticles.map((article: Article) => article.getHash());
        articles = articles.filter((article: Article) => !hashes.includes(article.getHash()));
        Events.emit("workers.articles.new", articles, tableName); // Can be empty array

        await Config.getOption(ConfigOptions.DB_PUSH_ARTICLES)(articles);
    }
}