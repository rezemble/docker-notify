const dockerAPI   = require('docker-hub-api');
const mailService = require('./mailService');
const Cache       = require('./Cache');

//parse repositories from env
let repositories = process.env.repositories.split(',').map((elem) => {
    let res = {};
    elem = elem.split('/');
    res.user = elem.length > 1 ? elem[0] : 'library';
    res.name = elem.length > 1 ? elem[1] : elem[0];
    //get tag if it is set
    if(res.name.split(':').length > 1){
        res.tag = res.name.split(':')[1];
        res.name = res.name.split(':')[0];
    }
    return res;
});

// get variables from env
let {
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpSenderName,
  smtpSenderAddress,
  smtpUsername,
  smtpPassword,
  mailReceiver,
  checkInterval
} = process.env;

smtpPort = parseInt(smtpPort);
checkInterval = parseInt(checkInterval);
smtpSecure = smtpSecure == 'true';

// initialize mail transporter
let mailTransporter = mailService(smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword);

// sends an email with a given message to the receiver which is defined in the env
let sendMail = (text) => {
    mailTransporter.verify().then(() => {
        let mailOptions = {
            from: `"${smtpSenderName}" <${smtpSenderAddress}>`,
            to: mailReceiver,
            subject: "Docker image updated",
            text
        };
        mailTransporter.sendMail(mailOptions).then((info) => {
            console.log("Notification mail sent: ", info);
        }).catch((err) => {
            console.error("Error while sending mail: ", err);
        });
    }).catch((err) => {
        console.error(err);
    });
};

let getRepositoryInfo = (user, name) => dockerAPI.repository(user, name);

let getTagInfo = (user, name) => dockerAPI.tags(user, name);

let checkRepository = (repository, repoCache) => new Promise((resolve, reject) => {
    let checkUpdateDates = (repoInfo) => {
        let updated;
        if(repoCache) {
            let cachedDate = Date.parse(repoCache.lastUpdated);
            let currentDate = Date.parse(repoInfo.last_updated);
            updated = cachedDate < currentDate;
        } else {
            updated = false;
        }
        resolve({
            lastUpdated: repoInfo.last_updated,
            name: repoInfo.name,
            user: repoInfo.user,
            updated: updated
        });
    }

    if(repository.tag) {
        getTagInfo(repository.user, repository.name).then((tags) => {
            let tagInfo = tags.filter((elem) => {
                return elem.name == repository.tag;
            })[0];
            tagInfo.user = repository.user;
            tagInfo.name = repository.name;
            checkUpdateDates(tagInfo);
        });
    } else {
        getRepositoryInfo(repository.user, repository.name).then(checkUpdateDates).catch((err) => {
            console.error("Error while fetching repo info: ", err);
            reject();
        });
    }
});

let checkForUpdates = () => {
    console.log("Checking for updated repositories");
    Cache.getCache().then((cache) => {
        let repoChecks = [];
        for(let repo of repositories) {
            repoChecks.push(checkRepository(repo, cache[repo.user + "/" + repo.name]));
        }
        Promise.all(repoChecks).then((checkResult) => {
            let newCache = {};
            let updatedRepos = [];
            for(let res of checkResult) {
                let strippedRes = {
                    user: res.user,
                    name: res.name,
                    lastUpdated: res.lastUpdated
                }
                newCache[res.user + "/" + res.name] = strippedRes;
                if(res.updated) {
                    let updatedString = res.user == "library" ? res.name : res.user + "/" + res.name;
                    updatedRepos.push(updatedString);
                }
            }
            Cache.writeCache(JSON.stringify(newCache)).then(() => {
                if(updatedRepos.length > 0) {
                    sendMail("These repositories have been updated: "+ updatedRepos.reduce((acc, current, index, array) => {
                        acc += current;
                        if(index != array.length - 1) {
                            acc += ", "
                        }
                        return acc;
                    }, ""));
                }
            }).catch((err) => {
                console.error("Error while writing cache file: ", err);
            })
        }).catch((err) => {
            console.error("Error while checking for updates:", err);
        })
    }).catch((err) => {
        console.error("Cannot open cache: ", err);
    });
};


checkForUpdates();

setInterval(checkForUpdates, 1000 * 60 * (checkInterval || 60));
