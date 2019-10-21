const puppeteer = require('puppeteer');
const fs = require('fs');
const Configstore = require('configstore');
const chalk = require('chalk');
const config = new Configstore('data');
const inquirer = require('inquirer');
const sql = require('sqlite3').verbose();

let browser;
let page;
let db;

(async () => {
    console.log(chalk.bgBlueBright.whiteBright('                         TwitterBot                         '));

    if (!config.get('user')) {
        console.log(chalk.redBright('No login details found'));
        await askLoginDetails();
    }

    if (!fs.existsSync('data.db')) {
        db = new sql.Database('data.db');
        await db.serialize(() => {
            db.run('CREATE TABLE interactions (' +
                '_ID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,' +
                'status TEXT NOT NULL,' +
                'url TEXT NOT NULL,' +
                'source TEXT NOT NULL,' +
                'timestamp INTEGER NOT NULL )');
        });
        console.log(chalk.yellowBright('[!] DB file created at ') + chalk.yellow('(data.db)'));
    } else {
        db = new sql.Database('data.db');
    }

    console.log(chalk.yellowBright('[!] Current user: ' + config.get('user')));
    const args = await askWhatToDo();

    switch (args.option) {
        case 'config':
            config.set('user', args.user);
            config.set('pwd', args.pwd);
            console.log(chalk.greenBright('\nConfig updated!'));
            break;
        case 'follow':
            if (!usernameIsCorrect(args.source)) {
                console.log(chalk.redBright('This Twitter user name cannot exist because it\'s invalid: ' + args.source));
                return;
            }

            await login(config.get('user'), config.get('pwd'), args.show);

            await followFollowersOf('https://twitter.com/' + args.source);
            await browser.close();
            break;
        case 'unfollow':
            await login(config.get('user'), config.get('pwd'), args.show);

            await unfollowUsers();
            await browser.close();
            break;
        case 'like':
            await login(config.get('user'), config.get('pwd'), args.show);

            await likeFeed(args.feed);

            await browser.close();
            break;
        case 'dislike':
            await login(config.get('user'), config.get('pwd'), args.show);

            await dislikeTweets();

            await browser.close();
            break;
        case 'retweet':
            await login(config.get('user'), config.get('pwd'), args.show);

            await retweetFeed(args.feed);

            await browser.close();
            break;
        case 'unretweet':
            await login(config.get('user'), config.get('pwd'), args.show);

            await unretweetTweets();

            await browser.close();
            break;
        case 'clean':
            config.clear();
            console.log(chalk.greenBright('Configuration cleaned!'));
            break;
        default:
            break;
    }

})();

async function askLoginDetails() {
    const loginQuestions = [ {
        type: 'input',
        name: 'user',
        message: 'Enter your Twitter username or mail:'
    }, {
        type: 'password',
        name: 'pwd',
        message: 'Enter your Twitter password:'
    } ];

    const loginDetails = await inquirer.prompt(loginQuestions);

    config.set('user', loginDetails.user);
    config.set('pwd', loginDetails.pwd);

    console.log(chalk.greenBright('User login details updated!'));
}

async function askWhatToDo() {
    const actionQuestions = [ {
        type: 'rawlist',
        name: 'option',
        message: 'What do you want to do?',
        choices: [
            { name: 'Update login configuration', value: 'config' },
            { name: 'Follow users', value: 'follow' },
            { name: 'Unfollow users', value: 'unfollow' },
            { name: 'Like tweets', value: 'like' },
            { name: 'Dislike tweets', value: 'dislike' },
            { name: 'Retweet tweets', value: 'retweet' },
            { name: 'Un-Retweet tweets', value: 'unretweet' },
            { name: 'Delete login information', value: 'clean' },
        ]
    }, {
        type: 'input',
        name: 'user',
        message: 'Enter your Twitter username or mail:',
        when: (responses) => {
            return responses.option === 'config';
        },
        default: config.get('user'),
    }, {
        type: 'password',
        name: 'pwd',
        message: 'Enter your Twitter password:',
        when: (responses) => {
            return responses.option === 'config';
        },
    }, {
        type: 'input',
        name: 'source',
        message: 'Enter a user from which to extract profiles:',
        when: (responses) => {
            return responses.option === 'follow';
        }
    }, {
        type: 'input',
        name: 'feed',
        message: 'Enter a hashtag from which to extract tweets:',
        when: (responses) => {
            return responses.option === 'like' || responses.option === 'retweet';
        }
    }, {
        type: 'confirm',
        name: 'show',
        message: 'Show browser working?',
        default: false,
        when: (responses) => {
            return responses.option !== 'config' && responses.option !== 'clean';
        }
    } ];
    const action = await inquirer.prompt(actionQuestions);
    //console.log(action);
    return action;
}

async function login(user, pwd, show) {
    browser = await puppeteer.launch({ headless: !show });
    page = await browser.newPage();
    await page.goto('https://twitter.com/login', { waitUntil: 'networkidle0' });
    await page.type('input[name="session[username_or_email]"]', user, { delay: 25 });
    await page.keyboard.press('Tab', { delay: 40 });
    await page.keyboard.type(pwd, { delay: 25 });
    await page.keyboard.press('Enter', { delay: 40 });

    await page.waitForSelector('div[data-testid="tweet"]');
    console.log(chalk.greenBright('Logged in as ' + user + '!'));
    console.log();
}


async function followFollowersOf(user) {
    console.log(`Following ${user} followers...`);

    let fileFollowers = await getUsersFromDB(`status IN ('followed', 'unfollowed')`);
    fileFollowers = fileFollowers.map(it => it.url);

    let userFollowers = await getUserFollowers(user);
    userFollowers = userFollowers.filter(it => !fileFollowers.includes(it));

    console.log(`${userFollowers.length} profiles obtained from user (${fileFollowers.length} were already contained in the DB)`);
    for (const [ i, follower ] of userFollowers.entries()) {
        const res = await follow(follower);
        if (res) {
            await db.run('INSERT INTO interactions(status, url, source, timestamp) VALUES("followed", ?, ?, ?);', follower, user, Date.now());
            console.log(`(${i + 1}/${userFollowers.length}) ${follower} followed! ${((i + 1) * 100 / userFollowers.length).toFixed(2)}%`)
        }
    }
    console.log(userFollowers.length + ' followers of ' + user + ' followed, logged usernames at DB');
    console.log();
}

async function getUserFollowers(user) {
    await page.goto(user + '/followers', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid = "UserCell"]');

    const followersRaw = await pager('[data-testid = "UserCell"] > div > div:nth-child(2) > div > div > a', 'href');
    const followers = followersRaw.map(it => 'https://twitter.com' + it);

    console.log(followers.length + ' profiles following ' + user + ' selected');
    await sleep(300);
    return followers;
}

async function follow(user) {
    await page.goto(user, { waitUntil: 'networkidle2' });
    await sleep(200);

    const result = await waitForProfile();

    switch (result.type) {
        case 'unfollow':
            console.log('Already following ' + user);
            return false;
        case 'cancel':
            console.log('Follow request already sent to ' + user);
            return false;
        case 'exists':
            console.log('User ' + user + ' doesn\'t exists');
            return false;
        case 'follow':
            await result.btn.click({ delay: 50 });
            await sleep(250);
            return true;
        case 'limit':
            console.log('\nTwitter actions limit reached! Waiting 30 seconds before continuing...');
            await sleep(30000);
            return false;
        case 'block':
            console.log(user + ' has blocked you...');
            await sleep(300);
            return false;
        default:
            console.log('Error while trying to follow ' + user);
    }
}


async function unfollowUsers(time, source) {
    console.log('Unfollowing ' + source + ' users...');

    const users = (await getUsersFromDB('status = "followed"'));
    //.filter(it => (!source || it.source === source) && (!time || it.time - Date.now() > time * 3600 * 1000))
    //TODO Filter in the SQL query
    console.log(users.length + ' users selected!\n');

    for (const user of users) {
        const res = await unfollow(user.url);
        if (res) {
            await db.exec('UPDATE interactions SET status = "unfollowed" WHERE _ID = ' + user.id);
        }
    }
}

async function unfollow(user) {
    await page.goto(user, { waitUntil: 'networkidle2' });
    await sleep(200);

    const result = await waitForProfile();

    switch (result.type) {
        case 'follow':
            console.log(user + ' wasn\'t followed');
            await sleep(250);
            return true;
        case 'unfollow':
            await result.btn.click({ delay: 50 });
            await page.waitForSelector('div[data-testid="confirmationSheetConfirm"] > div > span > span');
            await page.click('div[data-testid="confirmationSheetConfirm"] > div > span > span');
            console.log(user + ' unfollowed!');
            await sleep(250);
            return true;
        case 'cancel':
            await result.btn.click();
            await page.waitForSelector('div[data-testid="confirmationSheetConfirm"] > div > span > span');
            await page.click('div[data-testid="confirmationSheetConfirm"] > div > span > span');
            console.log(user + ' follow request cancelled!');
            await sleep(900);
            return true;
        case 'exists':
            console.log('User ' + user + ' doesn\'t exists');
            await sleep(900);
            return true;
        case 'limit':
            console.log('\nTwitter actions limit reached! Waiting 30 seconds before continuing...');
            await sleep(30000);
            return false;
        case 'block':
            console.log(user + ' has blocked you...');
            await sleep(300);
            return true;
        default:
            console.log('Error while trying to unfollow ' + user);
            return false;
    }
}


async function likeFeed(feed) {
    const url = 'https://twitter.com/' + feed.replace('#', 'hashtag/');
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('div[data-testid="tweet"]');

    const totalTweets = await pager('div[data-testid="tweet"] > div:nth-child(2) > div > div > a', 'href');
    for (const [ i, tweet ] of totalTweets.entries()) {
        const res = await like('https://twitter.com' + tweet);
        if (res) {
            await db.run('INSERT INTO interactions(status, url, source, timestamp) VALUES("liked", ?, ?, ?);', 'https://twitter.com' + tweet, url, Date.now());
            console.log(`(${i + 1}/${totalTweets.length}) ${tweet} liked! ${((i + 1) * 100 / totalTweets.length).toFixed(2)}%`)
        }
    }
}

async function dislikeTweets() {
    const tweets = (await getUsersFromDB('status = "liked"'));
    for (const [ i, tweet ] of tweets.entries()) {
        const res = await like(tweet.url, false);
        if (res) {
            await db.exec('UPDATE interactions SET status = "unliked" WHERE _ID = ' + tweet.id);
            console.log(`(${i + 1}/${tweets.length}) ${tweet.url} disliked! ${((i + 1) * 100 / tweets.length).toFixed(2)}%`)
        }
    }
}

async function like(tweet, like = true) {
    await page.goto(tweet, { waitUntil: 'networkidle2' });

    const actions = await page.waitForSelector(`div[role="group"]`);
    const likeBtn = await actions.$(`div[data-testid="${like ? 'like' : 'unlike'}"]`);
    if (likeBtn) {
        await likeBtn.click({ delay: 250 });
        return true;
    } else {
        console.log('The tweet ' + tweet + ' was already ' + (like ? 'liked' : 'disliked'));
        return false;
    }
}


async function retweetFeed(feed) {
    const url = 'https://twitter.com/' + feed.replace('#', 'hashtag/');
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('div[data-testid="tweet"]');

    const totalTweets = await pager('div[data-testid="tweet"] > div:nth-child(2) > div > div > a', 'href');
    for (const [ i, tweet ] of totalTweets.entries()) {
        const res = await retweet('https://twitter.com' + tweet);
        if (res) {
            await db.run('INSERT INTO interactions(status, url, source, timestamp) VALUES("retweeted", ?, ?, ?);', 'https://twitter.com' + tweet, url, Date.now());
            console.log(`(${i + 1}/${totalTweets.length}) ${tweet} liked! ${((i + 1) * 100 / totalTweets.length).toFixed(2)}%`)
        }
    }
}

async function unretweetTweets() {
    const tweets = (await getUsersFromDB('status = "retweeted"'));
    for (const [ i, tweet ] of tweets.entries()) {
        const res = await retweet(tweet.url, false);
        if (res) {
            await db.exec('UPDATE interactions SET status = "unretweeted" WHERE _ID = ' + tweet.id);
            console.log(`(${i + 1}/${tweets.length}) ${tweet.url} unretweeted! ${((i + 1) * 100 / tweets.length).toFixed(2)}%`)
        }
    }
}

async function retweet(tweet, retweet = true) {
    await page.goto(tweet, { waitUntil: 'networkidle2' });

    const actions = await page.waitForSelector(`div[role="group"]`);
    const mode = retweet ? 'retweet' : 'unretweet';
    const rtBtn = await actions.$(`div[data-testid="${mode}"]`);
    if (rtBtn) {
        await rtBtn.click({ delay: 250 });
        await sleep(100);
        await page.click(`div[data-testid="${mode}Confirm"] > div`, {delay: 200});
        return true;
    } else {
        console.log(`The tweet ${tweet} was already ${mode}ed`);
        return false;
    }
}


async function getUsersFromDB(filter) {
    const sql = 'SELECT * FROM interactions' + (filter ? ' WHERE ' + filter + ';' : ';');
    const interactions = [];
    return new Promise((resolve) => {
        db.each(sql, [], (err, row) => {
            interactions.push({
                id: row._ID,
                status: row.status,
                url: row.url,
                source: row.source,
                timestamp: row.timestamp
            });
        }, () => resolve(interactions));
    });
}

async function waitForProfile() {
    const followPromise = new Promise(resolve => {
        page.$$('div[class="css-1dbjc4n"] > div[style="min-width: 77px;"] > div[data-testid$="-follow"] > div > span > span')
            .then(res => {
                //console.log('follow resuelta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'follow', btn: res[0] });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });
    const unfollowPromise = new Promise(resolve => {
        page.$$('div[data-testid$="-unfollow"] > div > span > span')
            .then(res => {
                //console.log('unfollow resuleta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'unfollow', btn: res[0] });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });
    const cancelPromise = new Promise(resolve => {
        page.$$('div[data-testid$="-cancel"] > div > span > span')
            .then(res => {
                //console.log('request resuleta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'cancel', btn: res[0] });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });
    const existsPromise = new Promise(resolve => {
        page.$$('div.css-901oao.r-1re7ezh.r-1qd0xha.r-a023e6.r-16dba41.r-ad9z0x.r-bcqeeo.r-q4m81j.r-ey96lj.r-qvutc0 > span')
            .then(res => {
                //console.log('exists resuleta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'exists', btn: null });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });
    const limitPromise = new Promise(resolve => {
        page.$$('path[d^="M12 2C6.486 2 2 6.486 2 12c0"]')
            .then(res => {
                //console.log('limit resuleta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'limit', btn: res[0] });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });
    const blockPromise = new Promise(resolve => {
        page.$$('a[href="https://support.twitter.com/articles/20172060"] > span')
            .then(res => {
                //console.log('block resuleta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'block', btn: res[0] });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });
    const suspendedPromise = new Promise(resolve => {
        page.$$('a[href="https://support.twitter.com/articles/18311"] > span')
            .then(res => {
                //console.log('suspended resuleta ' + res.length);
                if (res.length === 1)
                    resolve({ type: 'suspended', btn: res[0] });
                else
                    resolve(null);
            }).catch(error => console.log(error));
    });

    const resultRaw = await Promise.all([ followPromise, unfollowPromise, cancelPromise, existsPromise, limitPromise, blockPromise, suspendedPromise ]);
    return resultRaw.filter(it => it !== null)[0];
}

async function pager(selector, attribute) {
    let set = new Set();
    for (let i = 0; i < 10; i++) {
        const elems = await page.evaluate((selec, attr) => [ ...document.querySelectorAll(selec) ].map(it => it.attributes[attr].value), selector, attribute);
        set = new Set([ ...set, ...elems ]);
        await scroll(1200);
    }
    return [ ...set ];
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function usernameIsCorrect(user) {
    return !(user.toLowerCase().includes('twitter') ||
        user.toLowerCase().includes('admin') ||
        user.length > 15 ||
        user.length <= 0 ||
        /[^\w]/g.test(user));
}

async function scroll(time) {
    await page.mouse.move(10, 10);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(10, 200);
    await sleep(time);
    await page.mouse.up({ button: 'middle' });
    await sleep(800);
}
