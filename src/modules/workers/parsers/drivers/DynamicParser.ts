import {ParserClass} from "../ParserClass";
import Instructions from "../../../../components/instructions";
import Job from "../../../../components/job";
import Article from "../../../../components/articles";
import Utils from "../../../../components/utils";
import Database from "../../../database";
import Logger from "../../../../middleware/logger";
import {LoggerTypes} from "../../../../middleware/LoggerTypes";

export class DynamicParser extends ParserClass {
    validateScrape(scrape: any): string {
        let value = typeof scrape != 'function'
        if(value)
            return ""
        else return "DynamicParser: scrape is not a function"
    }

    private static splice (base: string, idx: number, rem: number, str: string): string {
        return base.slice(0, idx) + str + base.slice(Math.abs(rem));
    }

    assignInstructions(instructions: Instructions, sourceJson: any): void {
        let scrapeStr = sourceJson.scrape.toString()

        instructions.endPoint = sourceJson.url
        instructions.scrapeFunction = DynamicParser.splice(scrapeStr
            , scrapeStr.indexOf('(')
            , scrapeStr.indexOf(')') + 1
            , "(Article, utils)")
    }

    async parse(job: Job, alias: string, url: string): Promise<Article[]> {
        let instructions = job.getInstructions();
        let parsedArticles: Article[] = [];

        let scrapeFunc = eval(instructions.scrapeFunction)

        let utils = new Utils(url);

        let collection = instructions.getSource().collection_name
        if (!collection || collection.length == 0)
            collection = instructions.getSource().name
        if (!collection || collection.length == 0)
            collection = instructions.getSource().getId()

        let articles = await Database.getInstance()!!.getArticles(collection, {pageNo: 1, articlesPerPage: 50})
        utils.isFirstScrape = articles.length === 0
        utils.isScrapeAfterError = job.attempts !== 0

        utils.getArticles = (count: number): Article[] => articles.slice(0, count)
        utils.onNewArticle = (article: Article) => {
            article.source = {
                id: job.getSource().getId(),
                name: job.getSource().name
            }

            if (!article.extras) article.extras = {}

            if (alias.length !== 0) {
                if(!article.categories)
                    article.categories = [];

                article.categories.push({name: alias, links: [url]});
            }

            articles.unshift(article)
            parsedArticles.push(article);
            utils.getArticles = (count: number): Article[] => [...articles].slice(0, count);
        }

        try {
            await scrapeFunc(Article, utils)
        }
        catch (e: any) {
            throw new Error(`DynamicParserException job failed for ${job.getSource().name}, original ${e.message}`);
        }

        return parsedArticles
    }

}