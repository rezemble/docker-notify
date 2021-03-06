const dockerAPI = require('docker-hub-api');
const mailService = require('./mailService');
const Cache = require('./Cache');

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

//get variables from env
let smtpHost = process.env.smtpHost;
let smtpPort = Number(process.env.smtpPort);
let smtpSecure = process.env.smtpSecure == "true";
let smtpSenderName = process.env.smtpSenderName;
let smtpSenderAddress = process.env.smtpSenderAddress;
let smtpUsername = process.env.smtpUsername;
let smtpPassword = process.env.smtpPassword;

let mailReceiver = process.env.mailReceiver;

//initialize mail transporter
let mailTransporter = mailService(smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword);

//sends an email with a given message to the receiver which is defined in the env
let sendMail = function(msg) {
    mailTransporter.verify().then(() => {
        let mailOptions = {
            from: '"' + smtpSenderName + '" <' + smtpSenderAddress + '>',
            to: mailReceiver,
            subject: "Docker image updated",
            text: msg
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

let getRepositoryInfo = function(user, name) {
    return dockerAPI.repository(user, name);
};

let getTagInfo = function(user, name) {
    return dockerAPI.tags(user, name);
}

let checkRepository = function(repository, repoCache) {
    return new Promise((resolve, reject) => {
        
        let checkUpdateDates = function(repoInfo) {
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
};

let checkForUpdates = function() {
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

let checkInterval = Number(process.env.checkInterval);

checkForUpdates();

setInterval(checkForUpdates, 1000 * 60 * (checkInterval || 60));