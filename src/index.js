const puppeteer = require('puppeteer');
const fs = require('fs');
const Configstore = require('configstore');
const chalk = require('chalk');
const config = new Configstore('data');
var inquirer = require('inquirer');

let browser;
let page;

(async () => {
    console.log(chalk.bgBlueBright.whiteBright('                         TwitterBot                         '));

    if (!config.get('user')) {
        console.log(chalk.redBright('No login details found'));
        await askLoginDetails();
    }

    console.log(chalk.yellowBright('Current user: ' + config.get('user')));
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

            await followFollowersOf(args.source, args.fileOut);
            await browser.close();
            break;
        case 'unfollow':
            await login(config.get('user'), config.get('pwd'), args.show);

            await unfollowUsersFromFile(args.fileIn);
            await browser.close();
            break;
        case 'like':
            await login(config.get('user'), config.get('pwd'), args.show);

            await likeFeed(args.feed, args.fileOut);

            await browser.close();
            break;
        case 'dislike':
            await login(config.get('user'), config.get('pwd'), args.show);

            const tweets = fs.readFileSync(args.fileIn, 'utf-8').split('\n');
            await dislikeTweets(tweets);

            await browser.close();

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
    },{
        type: 'input',
        name: 'feed',
        message: 'Enter a hashtag from which to extract tweets:',
        when: (responses) => {
            return responses.option === 'like';
        }
    }, {
        type: 'input',
        name: 'fileOut',
        message: 'Enter the file to save the log:',
        when: (responses) => {
            return responses.option === 'follow' || responses.option === 'like';
        },
        default: (responses) => {
            if (responses.option === 'follow')
                return 'data/followed.txt';
            if (responses.option === 'like')
                return 'data/liked.txt';
        }
    }, {
        type: 'input',
        name: 'fileIn',
        message: 'Enter the file with the saved data:',
        when: (responses) => {
            return responses.option === 'unfollow' || responses.option === 'dislike';
        },
        default: (responses) => {
            if (responses.option === 'unfollow')
                return 'data/followed.txt';
            if (responses.option === 'dislike')
                return 'data/liked.txt';
        }
    }, {
        type: 'confirm',
        name: 'show',
        message: 'Show browser working?',
        default: false,
    }
    ];
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


async function followFollowersOf(user, file = `data/followed.txt`) {
    console.log(`Following ${user} followers and login in ${file}...`);
    const userFollowers = await getUserFollowers(user);
    let followers = userFollowers;
    let fileFollowers = [];

    if (fs.existsSync(file)) {
        fileFollowers = getUsersFromFile(file).map(it => it.user);
        followers = userFollowers.filter(it => !fileFollowers.includes(it));
        console.log(`${userFollowers.length} profiles obtained from user but ${fileFollowers.length} were already contained in the file, following ${followers.length} profiles...`);
    }

    for (const [ i, follower ] of followers.entries()) {

        const res = await follow(follower);
        if (res) {
            fs.appendFileSync(file, `${follower},followed,${user},${Date.now()}\n`);
            console.log(`(${i + 1}/${followers.length}) ${follower} followed! ${((i + 1) * 100 / followers.length).toFixed(2)}%`)
        }
    }
    console.log(followers.length + ' followers of ' + user + ' followed, logged usernames at: ' + file);
    console.log();
}

async function getUserFollowers(user) {
    await page.goto(`https://twitter.com/${user}/followers`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid = "UserCell"]');

    const followersRaw = await pager('[data-testid = "UserCell"] > div > div:nth-child(2) > div > div > a', 'href');
    const followers = followersRaw.map(it => it.replace('/', ''));

    console.log(followers.length + ' profiles following ' + user + ' selected');
    await sleep(300);
    return followers;
}

async function follow(user) {
    await page.goto(`https://twitter.com/${user}`, { waitUntil: 'networkidle2' });
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


async function unfollowUsersFromFile(file = `data/followed.txt`, time, source) {
    console.log('Unfollowing ' + file + ' users...');

    const users = getUsersFromFile(file)
        .filter(it => (!source || it.source === source) && (!time || it.time - Date.now() > time * 3600 * 1000))
        .map(it => it.user);
    console.log(users.length + ' users selected!\n');

    for (const [ i, user ] of users.entries()) {
        if (usernameIsCorrect(user)) {
            const res = await unfollow(user);
            if (res) //TODO
                console.log('Replace in file')
        } else {
            console.log('ERROR: Omitting invalid username >' + user + '< found in line ' + (i + 1) + ' of the file');
        }
    }
}

async function unfollow(user) {
    await page.goto(`https://twitter.com/${user}`, { waitUntil: 'networkidle2' });
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


async function likeFeed(feed, file = `data/${feed}_liked.txt`) {
    const url = 'https://twitter.com/' + feed.replace('#', 'hashtag/');
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('div[data-testid="tweet"]');

    const totalTweets = await pager('div[data-testid="tweet"] > div:nth-child(2) > div > div > a', 'href');
    for (const [ i, tweet ] of totalTweets.entries()) {
        const res = await like('https://twitter.com' + tweet);
        if (res) {
            fs.appendFileSync(file, tweet + '\n');
            console.log(`(${i + 1}/${totalTweets.length}) ${tweet} liked! ${((i + 1) * 100 / totalTweets.length).toFixed(2)}%`)
        }
    }
}

async function dislikeTweets(tweets) {
    for (const [ i, tweet ] of tweets.entries()) {
        const res = await like('https://twitter.com' + tweet, false);
        if (res) {
            console.log(`(${i + 1}/${tweets.length}) ${tweet} disliked! ${((i + 1) * 100 / tweets.length).toFixed(2)}%`)
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


function getUsersFromFile(file) {
    return fs.readFileSync(file, 'utf-8').split('\n').map(line => {
        const data = line.split(',');
        return {
            user: data[0],
            status: data[1],
            source: data[2],
            timestamp: data[3]
        }
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
