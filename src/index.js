const puppeteer = require('puppeteer');
const fs = require('fs');
const minimist = require('minimist');

let browser;
let page;

(async () => {
    const args = minimist(process.argv.slice(2), {
        string: [ 'mode', 'user', 'file', 'login_mail', 'login_pwd', 'feed' ],
        boolean: [ 'show' ],
        alias: {
            show: 's',
            mode: 'm',
            user: 'u',
            file: 'f',
            login_mail: 'l',
            login_pwd: 'p',
        },
        default: {
            mode: 'config',
            show: true //TODO Change this for production
        }
    });

    console.log(args);
    console.log();


    switch (args.mode) {
        case 'config':
            setConfig({ user: args.login_mail, pwd: args.login_pwd });
            break;
        case 'follow':
            if (!usernameIsCorrect(args.user))
                throw new Error('This Twitter user name cannot exist because it\'s invalid: ' + user);

            await loginSequence(args);

            await followFollowersOf(args.user, args.file);
            await browser.close();
            break;
        case 'unfollow':
            await loginSequence(args);

            await unfollowUsersFromFile(args.file);
            await browser.close();
            break;
        case 'like':
            await loginSequence(args);

            await likeFeed(args.feed, args.file);

            await browser.close();
            break;
        case 'dislike':
            await loginSequence(args);

            const tweets = fs.readFileSync(args.file, 'utf-8').split('\n');
            await dislikeTweets(tweets);

            await browser.close();

            break;
    }

})();

async function loginSequence(args) {
    if ('login_mail' in args && 'login_pwd' in args) {
        console.log('Logging in...');
        await login({ user: args.login_mail, pwd: args.login_pwd }, args.show);
    } else if (fs.existsSync('config')) {
        console.log('Logging in with CONFIG details...');
        const loginInfo = fs.readFileSync('config', 'utf-8');
        await login(JSON.parse(loginInfo), args.show);
    } else {
        throw new Error('No logging details provided by either parameters or configuration')
    }
}

async function login(login, show) {
    browser = await puppeteer.launch({ headless: !show });
    page = await browser.newPage();
    await page.goto('https://twitter.com/login', { waitUntil: 'networkidle0' });
    await page.type('input.email-input', login.user, { delay: 25 });
    await page.type('input.js-password-field', login.pwd, { delay: 25 });
    await page.click('button.submit', { delay: 30 });

    //Quitar el cuadro de las cookies
    await page.waitForSelector('div[data-testid="tweet"]');
    console.log('Logged in as ' + login.user + '!');
    console.log();
}


async function followFollowersOf(user, file = `data/followed.txt`) {
    console.log(`Following ${user} followers and login in ${file}...`);
    const userFollowers = await getUserFollowers(user);
    let followers = userFollowers;
    let fileFollowers = [];

    if (fs.existsSync(file)) {
        fileFollowers = getUsersFromFile(file, 'followed').map(it => it.user);
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
        default:
            console.log('Error while trying to follow ' + user);
    }
}


async function unfollowUsersFromFile(file = `data/followed.txt`, source, time) {
    console.log('Unfollowing ' + file + ' users...');

    const users = getUsersFromFile(file, 'followed').map(it => it.user);
    console.log(users);

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


function getUsersFromFile(file, filter) {
    return fs.readFileSync(file, 'utf-8').split('\n').map(line => {
        const data = line.split(',');
        console.log(data);
        return {
            user: data[0],
            status: data[1],
            source: data[2],
            timestamp: data[3]
        }
    }).filter(it => !filter || it.status === filter);
}

async function waitForProfile(){
    const followPromise = new Promise((resolve, reject) => {
        page.$$('div[class="css-1dbjc4n"] > div[style="min-width: 77px;"] > div[data-testid$="-follow"] > div > span > span')
        .then(res => {
            //console.log('follow resuelta ' + res.length);
            if (res.length === 1)
                resolve({ type: 'follow', btn: res[0] });
            else
                resolve(null);
        }).catch(error => console.log(error));
    });
    const unfollowPromise = new Promise((resolve, reject) => {
        page.$$('div[data-testid$="-unfollow"] > div > span > span')
        .then(res => {
            //console.log('unfollow resuleta ' + res.length);
            if (res.length === 1)
                resolve({ type: 'unfollow', btn: res[0] });
            else
                resolve(null);
        }).catch(error => console.log(error));
    });
    const cancelPromise = new Promise((resolve, reject) => {
        page.$$('div[data-testid$="-cancel"] > div > span > span')
        .then(res => {
            //console.log('request resuleta ' + res.length);
            if (res.length === 1)
                resolve({ type: 'cancel', btn: res[0] });
            else
                resolve(null);
        }).catch(error => console.log(error));
    });
    const existsPromise = new Promise((resolve, reject) => {
        page.$$('div.css-901oao.r-1re7ezh.r-1qd0xha.r-a023e6.r-16dba41.r-ad9z0x.r-bcqeeo.r-q4m81j.r-ey96lj.r-qvutc0 > span')
        .then(res => {
            //console.log('exists resuleta ' + res.length);
            if (res.length === 1)
                resolve({ type: 'exists', btn: null });
            else
                resolve(null);
        }).catch(error => console.log(error));
    });
    const limitPromise = new Promise(((resolve, reject) => {
        page.$$('path[d^="M12 2C6.486 2 2 6.486 2 12c0"]')
        .then(res => {
            //console.log('limit resuleta ' + res.length);
            if (res.length === 1)
                resolve({ type: 'limit', btn: res[0] });
            else
                resolve(null);
        }).catch(error => console.log(error));
    }));

    const resultRaw = await Promise.all([ followPromise, unfollowPromise, cancelPromise, existsPromise, limitPromise ]);
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

function setConfig(info) {
    if (fs.existsSync('config'))
        console.log('Overriding saved configuration...');
    fs.writeFileSync('config', JSON.stringify(info));
    console.log('Configuration saved!');
    console.log();
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
