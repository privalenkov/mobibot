import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import TelegramAPI from 'node-telegram-bot-api';
import fsExtra from 'fs-extra';
import cron from 'node-cron';
import { cleanDirectory, uploadFile } from './google-api/api.js';

export default class Mobibot {
    constructor(tg_token, settings) {
        this.tgApi = new TelegramAPI(tg_token, { polling: true });
        this.settings = settings;
        this.commands = [
            { command: '/help', description: 'Все команды' },
            { command: '/get', description: 'Получить ссылку на приложение и шаблон' },
            { command: '/addadmin', description: 'Добавить администратора /addadmin <user_name>' },
            { command: '/adminlist', description: 'Список администраторов' },
            { command: '/rmadmin', description: 'Удалить администратора /rmadmin <user_name>' },
            { command: '/addfront', description: 'Добавить верстальщика в список /addadmin <user_name>' },
            { command: '/frontlist', description: 'Список верстальщиков' },
            { command: '/rmfront', description: 'Удалить верстальщика /rmfront <user_name>' },
            { command: '/build', description: 'Вручную пересобрать шаблон и получить ссылку' },
            { command: '/settime', description: 'Создать ежедневный таймер на сборку шаблона. /settime <day> <hours> <minutes> Пример: /settime fri 9 40' },
            { command: '/rmtime', description: `Отключить ежедневный таймер на сборку шаблона` },
        ];
        this.taskTimer = null;
        this.appVersion;
    }

    init() {
        if (!this.settings) console.log('Пожалуйста, пропишите файл настроект в конструктор');
        this.tgApi.setMyCommands(this.commands);

        if (this.settings.events.includes('message')) {
            this.tgApi.on('message', async msg => {
                const text = msg.text;
                const chatId = msg.chat.id;
                const username = msg.from.username;
                if (!chatId) return;
                
                if (/^\//.test(text)) {
                    if (!this.settings.permission.includes(username)) {
                        await this.tgApi.sendMessage(chatId, 'Недостаточно прав');
                        return
                    };
                    const cmd  = text.split(' ')[0];
                    
                    switch (cmd) {
                        case '/help':
                            await this.tgApi.sendMessage(chatId, this.commands.map((item) => Object.values(item)).map((item2) => item2.join(' - ')).join(', \n'));
                            break;
                        case '/get':
                            await this.tgApi.sendMessage(chatId, this.settings.googleShareLink);
                            break;
                        case '/adminlist':
                            await this.tgApi.sendMessage(chatId, this.settings.permission.join(', '));
                            break;
                        case '/rmadmin':
                            const rmAdm = text.match(/\/rmadmin (.+)/);
                            if(!rmAdm) {
                                await this.tgApi.sendMessage(chatId, 'Укажите имя пользователя. /rmadmin <user_name>');
                                return;
                            }

                            this._removeAdmin(chatId, rmAdm[1]);
                            break;
                        case '/addadmin':
                            const resp = text.match(/\/addadmin (.+)/);
                            if(!resp) {
                                await this.tgApi.sendMessage(chatId, 'Укажите имя пользователя. /addadmin <user_name>');
                                return;
                            }

                            this._addAdmin(chatId, resp[1]);
                            break;
                        case '/frontlist':
                            await this.tgApi.sendMessage(chatId, this.settings.fronts.join(', '));
                            break;
                        case '/rmfront':
                            const rmfront = text.match(/\/rmfront (.+)/);
                            if(!rmfront) {
                                await this.tgApi.sendMessage(chatId, 'Укажите имя пользователя. /rmfront <user_name>');
                                return;
                            }

                            this._removeFront(chatId, rmfront[1]);
                            break;
                        case '/addfront':
                            const front = text.match(/\/addfront (.+)/);
                            if(!front) {
                                await this.tgApi.sendMessage(chatId, 'Укажите имя пользователя. /addfront <user_name>');
                                return;
                            }

                            this._addFront(chatId, front[1]);
                            break;
                        case '/build':
                            const build = await this._buildAndUpload();
                            if (!build) return;

                            await this.tgApi.sendMessage(chatId, `‼️ Новая версия ${this.appVersion || ''} ${this.settings.googleShareLink}`);
                            await this.tgApi.sendMessage(chatId, 'Если вы еще не закончили свою тему, то просто скопируйте все плагины из нового шаблона, кроме папки theme');
                            break;
                        case '/settime':
                            try {
                                if (this.taskTimer) {
                                    await this.tgApi.sendMessage(chatId, 'Таймер уже установлен');
                                    return;
                                }

                                const timer = text.match(/\/settime (.+) (.+) (.+)/);
                                if(!timer) {
                                    await this.tgApi.sendMessage(chatId, 'Укажите параметры. /settime <day> <hours> <minutes> Пример: /settime fri 9 40');
                                    return;
                                }
        
                                this.taskTimer = cron.schedule(`${timer[3]} ${timer[2]} * * ${timer[1]}`, async () => {
                                    const build = await this._buildAndUpload();
                                    if (!build) return;
    
                                    await this.tgApi.sendMessage(chatId, `‼️ Новая версия ${this.appVersion || ''} ${this.settings.googleShareLink}`);
                                    await this.tgApi.sendMessage(chatId, 'Если вы еще не закончили свою тему, то просто скопируйте все плагины из нового шаблона, кроме папки theme');
                                });
                                await this.tgApi.sendMessage(chatId, `Ежедневный таймер установлен на ${timer[1]} ${timer[2]}:${timer[3]}`);
                                
                            } catch (err) {
                                console.log(err);
                                await this.tgApi.sendMessage(chatId, `Произошла ошибка установки ежедневного таймера. Ошибка: ${err}`);
                            }
                            break;
                        case '/rmtime':
                            if (!this.taskTimer) {
                                await this.tgApi.sendMessage(chatId, 'Ежедневный таймер не установлен');
                                return;
                            };
                            this.taskTimer.stop();
                            this.taskTimer = null;
                            await this.tgApi.sendMessage(chatId, 'Ежедневный таймер отключен');
                            break;
                    
                        default:
                            await this.tgApi.sendMessage(chatId, 'Такой команды нет');
                            break;
                    }
                }
            })
        };
    }
    async _buildAndUpload () {
        const build = await this._build(this.settings.pathToBuildsDir);
        if (!build) return false;

        const isUploaded = this._uploadToGoogleDisk(build.template, build.appWinName, build.appMacName);
        if (!isUploaded) return false;
        return build.template;
    }
    
    _getVersion (fileName) {
        const version = fileName.match(/-(\d.+)-/);
        if (!version) return '';
        return version[0].replace('-win-', '').replace('-', '');
    }

    async _build (dir) {
        const folders = this._getMostRecentFile('devel', dir);
        if (!folders) return false;
        
        const winFileName = fs.readdirSync(path.join(dir, folders.win.file));
        const macFileName = fs.readdirSync(path.join(dir, folders.mac.file));

        if (!winFileName.length || !macFileName.length) return false;

        this.appVersion = this._getVersion(winFileName[0]);

        const isNew = this._checkAndUpdateVersionApp();
        if (!isNew) {
            console.log(`Current version ${this.appVersion} is already uploaded`);
            return false
        };
        
        const currentPathWin = path.join(dir, folders.win.file, winFileName[0]);
        const currentPathWMac = path.join(dir, folders.mac.file, macFileName[0]);
        
        try {
            fsExtra.emptyDirSync('./temp');
            fs.mkdirSync('./temp/win');
            fs.mkdirSync('./temp/mac');
            fs.copyFileSync(currentPathWin, path.join('./temp/win', winFileName[0]));
            fs.copyFileSync(currentPathWMac, path.join('./temp/mac', macFileName[0]));
        }
        catch (err) {
            console.log(err);
            return false;
        }
        const template = await this._getTemplate(winFileName[0]);
        if (!template) return false;

        return {template, appWinName: winFileName[0], appMacName: macFileName[0]};
    }

    async _getTemplate (fileName) {
        try {
            const extract = new AdmZip(path.join('./temp/win', fileName));
            extract.extractEntryTo('web/app/themes/mobirise5/', './temp/data', null, true);
            const zip = new AdmZip();
            zip.addLocalFolder('./temp/data/web/app/themes/mobirise5/');
            const isZip = await zip.writeZipPromise(`./temp/theme-template-${this.appVersion || ''}.zip`);
            if (!isZip) return false;
            return {templateName: `theme-template-${this.appVersion || ''}`};
        } catch (err) {
            console.log(err);
            return false;
        }
    };

    async _uploadToGoogleDisk (template, appWinName, appMacName) {
        const isClean = await cleanDirectory(this.settings.googleFolderID);
        if (!isClean) return false;
        await Promise.all([
            uploadFile('./temp/win', this.settings.googleFolderID, appWinName, 'application/zip'),
            uploadFile('./temp/mac', this.settings.googleFolderID, appMacName, 'application/zip'),
            uploadFile('./temp', this.settings.googleFolderID, template.templateName, 'application/zip')
        ]);
        return true;
    };
    
    _getMostRecentFile (type, dir) {
        const files = this._orderReccentFiles(dir);
        if (!files.length) return undefined;

        const win = files.find((file) => new RegExp('-win-' + type).test(file.file));
        const mac = files.find((file) => new RegExp('-mac-' + type).test(file.file));
        if (!win || !mac) return undefined;

        return {
            win,
            mac
        };
    };

    _orderReccentFiles (dir) {
        return fs.readdirSync(dir)
            .filter(file => fs.lstatSync(path.join(dir, file)).isDirectory())
            .map(file => ({ file, mtime: fs.lstatSync(path.join(dir, file)).mtime }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    };

    async _removeAdmin(chatId, resp) {
        if (!this.settings.permission.includes(resp)) {
            await this.tgApi.sendMessage(chatId, `Администратор ${resp} не найден`);
            return;
        };

        this.settings.permission = this.settings.permission.filter((str) =>  str !== resp)
        fs.writeFileSync("settings.json", JSON.stringify(this.settings, null, ' '), 'utf8', function (err) {
            if (err) return console.log(err);
        });
        await this.tgApi.sendMessage(chatId, `Администратор ${resp} удален`);
    }   

    async _addAdmin(chatId, resp) {
        this.settings.permission.push(resp);
        fs.writeFileSync("settings.json", JSON.stringify(this.settings, null, ' '), 'utf8', function (err) {
            if (err) return console.log(err);
        });
        await this.tgApi.sendMessage(chatId, `Новый администратор ${resp} добавлен`);
    }

    _checkAndUpdateVersionApp () {
        if (this.settings.currentAppVersion === this.appVersion) return false;
        this.settings.currentAppVersion = this.appVersion;
        fs.writeFileSync("settings.json", JSON.stringify(this.settings, null, ' '), 'utf8');
        return true;
    }

    async _removeFront(chatId, resp) {
        if (!this.settings.fronts.includes(resp)) {
            await this.tgApi.sendMessage(chatId, `Верстальщик ${resp} не найден`);
            return;
        };

        this.settings.fronts = this.settings.fronts.filter((str) =>  str !== resp)
        fs.writeFileSync("settings.json", JSON.stringify(this.settings, null, ' '), 'utf8', function (err) {
            if (err) return console.log(err);
        });
        await this.tgApi.sendMessage(chatId, `Верстальщик ${resp} удален`);
    }

    async _addFront(chatId, resp) {
        this.settings.fronts.push(resp);
        fs.writeFileSync("settings.json", JSON.stringify(this.settings, null, ' '), 'utf8', function (err) {
            if (err) return console.log(err);
        });
        await this.tgApi.sendMessage(chatId, `Новый верстальщик ${resp} добавлен`);
    }
}