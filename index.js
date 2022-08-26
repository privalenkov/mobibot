import 'dotenv/config';
import settings from './settings.json' assert {type: 'json'};
import Mobibot from './mobi-bot.js';

const TG_TOKEN = process.env.TG_TOKEN;
new Mobibot(TG_TOKEN, settings).init();
