import Job from "../components/job";
import Instructions from "./instructions";
import {ParserType} from "./ParserType";
import Article from "./article";
import Config, {ConfigOptions} from "./config";
import ParserLoader from "../modules/parsers/ParserLoader";


export default class Source {

    static _sources: Source[] = [];

    declare name: string;
    declare tableName: string;
    declare interval: number;
    declare retryInterval: number;
    declare timeout: number;
    declare instructions: Instructions;
    declare extra: any;
    private declare id: string;

    /**
     * Parse and store a source file contents to an array in memory
     * @param source the source file
     */
    static fileToSource(source: any): Source {
        source.filename = source.filename ? source.filename : source.name ? source.name : 'unknown filename';

        let ret = new Source();

        // Source name
        if (source.name == null || source.name.length < 3)
            throw new Error(`SourceException: [${source.filename}] Field name is not valid, requirements(type = string, length >= 3).`);
        ret.name = source.name;

        // Source tableName
        if (source.tableName != null && (typeof source.tableName !== 'string' || source.tableName.length < 3 || ["saffron", "config", "workers"].includes(source.tableName)))
            throw new Error(`SourceException: [${source.filename}] Field tableName  is not valid, requirements(type = string, length >= 3, != saffron, != workers, != config).`);
        ret.tableName = source.tableName;

        if (source.interval != null && (typeof source.interval != 'number' || source.interval < 0))
            throw new Error(`SourceException: [${source.filename}] Field interval is not valid, requirements(type = number, positive or zero).`);
        ret.interval = source.interval ? source.interval : Config.getOption(ConfigOptions.SCHEDULER_JOB_INT);

        if (source.retryInterval != null && (typeof source.retryInterval != 'number' || source.retryInterval < 0))
            throw new Error(`SourceException: [${source.filename}] Field retryInterval is not valid, requirements(type = number, positive or zero).`);
        ret.retryInterval = source.retryInterval ? source.retryInterval : Config.getOption(ConfigOptions.SCHEDULER_JOB_INT) / 2;

        if (source.timeout != null && (typeof source.timeout != 'number' || source.timeout < 0))
            throw new Error(`SourceException: [${source.filename}] Field timeout  is not valid, requirements(type = number, positive or zero).`);
        ret.timeout = source.timeout ? source.timeout : Config.getOption(ConfigOptions.REQUEST_TIMEOUT);

        ret.extra = source.extra;

        const instructions = new Instructions();
        ret.instructions = instructions;
        instructions.source = {id: ret.getId()}

        if (source.amount != null && (typeof source.amount != 'number' || source.amount <= 0))
            throw new Error(`SourceException: [${source.filename}] Field amount is not valid, requirements(type = number, positive).`);
        instructions.amount = source.amount ? source.amount : Config.getOption(ConfigOptions.ARTICLE_AMOUNT);

        if (source.ignoreCertificates != null && typeof source.ignoreCertificates !== 'boolean')
            throw new Error(`SourceException: [${source.filename}] Field ignoreCertificates is not valid, requirements(type = boolean).`);
        instructions.ignoreCertificates = source.ignoreCertificates ? source.ignoreCertificates : false;

        if (source.encoding != null && typeof source.encoding !== 'string')
            throw new Error(`SourceException: [${source.filename}] Field encoding is not valid requirements(type = string).`);
        instructions.textDecoder = source.encoding ? new TextDecoder(`${source.encoding}`) : new TextDecoder();


        instructions.url = [];
        if (typeof source.url === 'string') {
            if (source.url.length == 0)
                throw new Error(`SourceException: [${source.filename}] Field url is not valid, requirements(type = string, not empty).`);
            instructions.url.push({url: source.url, aliases: []});
        } else if (Array.isArray(source.url)) {
            for (const pair of source.url) {
                if (Array.isArray(pair) && pair.length >= 2) {
                    let aliases = pair.slice(0, pair.length - 1);
                    let url = pair[pair.length - 1];

                    aliases.forEach(alias => {
                        if (typeof alias !== 'string' || alias.trim() === '')
                            throw new Error(`SourceException: [${source.filename}] At field url, field alias is not valid, requirements(type = string, not empty, not whitespace).`);
                    });

                    if (typeof url !== 'string' || url.trim() === '')
                        throw new Error(`SourceException: [${source.filename}] At field url, field url is not valid, requirements(type = string, not empty not whitespace).`);

                    instructions.url.push({url, aliases});
                } else if (typeof pair === 'string' || ((Array.isArray(pair) && pair.length == 1))) {
                    let url: any = pair;
                    if (Array.isArray(pair)) url = pair[0];

                    instructions.url.push({url, aliases: []});
                } else
                    throw new Error(`SourceException: [${source.filename}] Field url is not valid, requirements(type = string[] | string[][]).`);
            }
        } else
            throw new Error(`SourceException: [${source.filename}] Field url is not valid, requirements(type = string | string[] | string[][]).`);

        let parserType = ParserType.getFromString(source.type);
        if (parserType === ParserType.UNKNOWN)
            throw new Error(`SourceException: [${source.filename}] Field type is not valid, requirements(equals html, rss, dynamic, wordpress-v1, wordpress-v2).`);
        instructions.parserType = parserType;

        try {
            ParserLoader.validateScrapeOptions(parserType, source.scrape);
        } catch (e: any) {
            throw new Error(`SourceException: [${source.filename}] Field scrape is not valid, parser error: ${e.message}`);
        }

        ParserLoader.assignScrapeInstructions(parserType, ret.instructions, source);

        return ret;
    }

    static pushSource(source: Source) {
        this._sources.push(source);
    }

    /**
     * Return an array of the parsed sources.
     */
    static getSources(): Source[] {
        return this._sources;
    }

    /**
     * Return the source class based on job, article or source id
     * @param from
     */
    static getSourceFrom(from: Job | Article | Instructions | string): Source {
        let id = '';
        if (from instanceof Job || from instanceof Article || from instanceof Instructions)
            id = from.source?.id;
        else id = from;

        return this._sources.find(source => source.getId() === id)!;
    }

    /**
     * Generate and return the id of the source
     */
    getId(): string {
        if (!this.id)
            this.id = `src_${this.name}`;
        return this.id;
    }
}