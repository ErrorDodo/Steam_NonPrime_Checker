var User = require('steam-user');
var fs = require('fs');
const Protos = require('./helpers/protos.js');

var inputFile = process.argv.slice(2)[0];
var outputFile = process.argv.slice(2)[1];
var arrayAccountsTxt = fs.readFileSync(`${inputFile}`).toString().split('\n');

var current_count = 0;
var results = [];
var dodogay = [];

var testObj = [];

function sleep(ms) {
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    });
}

var _consolelog = console.log;
console.log = (...args) => {
    args.unshift(`[INFO]:`);
    _consolelog(...args);
}

function check_account(username, pass) {
    ++current_count;

    let attempts = 0;
    let AcknowledgedPenalty = false;
    let steamClient = new User({
            //httpProxy: ''
        }
    );

    steamClient.logOn({
        "accountName": username,
        "password": pass
    });

    steamClient.on('disconnected', (eresult, msg) => {
        --current_count;
    });

    steamClient.on('error', (e) => {
        console.log(e);

        let errorStr = ``;
        switch(e.eresult) {
            case 5: {
                errorStr = `Invalid Password`;
                break;
            }
            case 6:
            case 34: {
                errorStr = `Logged In Elsewhere`;
                break;
            }
            case 84: {
                errorStr =  `Rate Limit Exceeded`;
                break;
            }
            default: {
                errorStr = `Unknown: ${e.eresult}`;
                break;
            }
        }

        results.push( { 
            login: `${username}:${pass}`,
            error: errorStr,
            penalty_reason: 0,
            penalty_seconds: 0,
            wins: 0,
            rank: 0
        });

        --current_count;
    });

    steamClient.on('steamGuard', (domain, callback) => {
        results.push( { 
            login: `${username}:${pass}`,
            error: `steam guard is enabled`,
            penalty_reason: 0,
            penalty_seconds: 0,
            wins: 0,
            rank: 0
        });

        --current_count;
    });

    steamClient.on('vacBans', (numBans, appids) => {
        if(numBans > 0 && appids.indexOf(730) != -1) {
            steamClient.logOff();
        }
        else {
            steamClient.gamesPlayed(730);
        }
    });

    steamClient.on('appLaunched', (appid) => {
        sleep(5000).then(() => {
            console.log(`appLaunched: sendToGC`);
            steamClient.sendToGC(appid, 4006, {}, Buffer.alloc(0));
        });
    });

    steamClient.on('receivedFromGC', (appid, msgType, payload) => {
        switch(msgType) {
            case 4004: {
                sleep(2000).then(() => {
                    steamClient.sendToGC(appid, 9109, {}, Buffer.alloc(0));
                });
                break;
            }
            case 9110: {
                let msg = this.Protos.csgo.CMsgGCCStrike15_v2_MatchmakingGC2ClientHello.decode(payload);
                msg = this.Protos.csgo.CMsgGCCStrike15_v2_MatchmakingGC2ClientHello.toObject(msg, { defaults: true });

                if(msg.penalty_reason === 10) {
                    steamClient.logOff();
                    return;
                }

                if(!AcknowledgedPenalty && msg.penalty_seconds > 0) {
                    let message = this.Protos.csgo.CMsgGCCStrike15_v2_AcknowledgePenalty.create({
                        acknowledged: 1
                    });
                    let encoded = this.Protos.csgo.CMsgGCCStrike15_v2_AcknowledgePenalty.encode(message);

                    sleep(2000).then(() => {
                        steamClient.sendToGC(appid, 9171, {}, encoded.finish());
                    });

                    AcknowledgedPenalty = true;

                    sleep(2000).then(() => {
                        steamClient.sendToGC(appid, 4006, {}, Buffer.alloc(0));
                    });

                    return;
                }

                ++attempts;
                if(msg.ranking === null && attempts < 5) {
                    sleep(2000).then(() => {
                        steamClient.sendToGC(appid, 9109, {}, Buffer.alloc(0));
                    });
                }
                else {
                    if(dodogay.indexOf(username) == -1) {
                        dodogay.push(username);
                        
                        if(attempts < 5) {
                            results.push( { 
                                login: `${username}:${pass}`,
                                penalty_reason: msg.penalty_reason,
                                penalty_seconds: msg.penalty_seconds,
                                wins: msg.ranking.wins,
                                rank: msg.player_level
                            });
                        }
                        else {
                            testObj.push({ login: `${username}:${pass}`, data: msg });

                            results.push( { 
                                login: `${username}:${pass}`,
                                error: `failed to get wins`,
                                penalty_reason: msg.penalty_reason,
                                penalty_seconds: msg.penalty_seconds,
                                wins: 0,
                                rank: msg.player_level
                            });
                        }
                    }

                    steamClient.logOff();
                }
                break;
            }
            default: break;
        }
    });
}

async function run() {
    this.Protos = Protos([{
        name: "csgo",
        protos: [
            __dirname + "/protos/cstrike15_gcmessages.proto",
        ]
    }]);

    for (var i = 0; i < arrayAccountsTxt.length;) {
        const accInfo = arrayAccountsTxt[i].trim().split(':');
        const username = accInfo[0];
        const password = accInfo[1];

        if(current_count >= 50)  {
            await sleep(5000);
        }
        else {
            console.log(`${username} ${i + 1} / ${arrayAccountsTxt.length}`);
            check_account(username, password);
            
            ++i;
        }
    }

    while(current_count) {
        console.log(current_count.toString());
        await sleep(2000);
    }

    fs.writeFile(`${outputFile}`, JSON.stringify(results, null, 4), (err) => {
        if (err)  {
            return console.log(`writeFile: ${err}`);
        }
    });

    if (testObj.length > 0) {
        fs.writeFile(`testobj.json`, JSON.stringify(testObj, null, 4), (err) => {
            if (err) {
                return console.log(`writeFile: ${err}`);
            }
        });
    }
}

for(var i = 0; i < arrayAccountsTxt.length; ++i) {
    let str = arrayAccountsTxt[i].trim();
    let index = str.indexOf(' ');
    if(index > 0) {
        str = str.substr(0, index);
    }
    arrayAccountsTxt[i] = str;
}

arrayAccountsTxt = arrayAccountsTxt.filter((elem, pos) => {
    return elem.trim() && arrayAccountsTxt.indexOf(elem) == pos;
});

run();