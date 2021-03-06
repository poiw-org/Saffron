import Article from "./article";

export type ParserResult = {
    aliases: string[];
    url: string;
    articles: Article[];
};

export type CallbackVoid = (...args: any[]) => void;