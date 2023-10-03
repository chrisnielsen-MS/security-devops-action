import * as https from "https";
import * as core from '@actions/core';
import * as exec from '@actions/exec';

const sendReportRetryCount: number = 1;

async function run() {
    let startTime = core.getState('PreJobStartTime');
    if (startTime.length <= 0) {
        console.log(`PreJobStartTime not defined, using now-10secs `);
        startTime = new Date(new Date().getTime() - 10000).toISOString();
    }

    let dockerVer = Buffer.alloc(0);
    let dockerEvents = Buffer.alloc(0);
    let dockerImages = Buffer.alloc(0);
    
    // Initialize the commands 
    await exec.exec('docker --version', null, {
        listeners: {
            stdout: (data: Buffer) => {
                dockerVer = Buffer.concat([dockerVer, data]);
            }
        }
    });
    await exec.exec(`docker events --since ${startTime} --until ${new Date().toISOString()} --filter event=push --filter type=image --format ID={{.ID}}`, null, {
        listeners: {
            stdout: (data: Buffer) => {
                dockerEvents = Buffer.concat([dockerEvents, data]);
            }
        }
    });
    await exec.exec('docker images --format CreatedAt={{.CreatedAt}}::Repo={{.Repository}}::Tag={{.Tag}}::Digest={{.Digest}}', null, {
        listeners: {
            stdout: (data: Buffer) => {
                dockerImages = Buffer.concat([dockerImages, data]);
            }
        }
    });

    // Post data to URI
    let data = {
        dockerVer: dockerVer.toString(),
        dokcerEvents: dockerEvents.toString(),
        dockerImages: dockerImages.toString()
    };

    core.debug("Finished data collection, starting API calls.");

    await sendReport(data, sendReportRetryCount);
}

async function sendReport(data: Object, retryCount: number = 0): Promise<Object> {
    return new Promise(async (resolve, reject) => {
        do {
            try {
                let resData = await _sendReport(data);
                resolve(resData);
                break;
            } catch (error) {
                if (retryCount == 0) {
                    reject('Failed to send report: ' + error);
                } else {
                    retryCount--;
                    core.debug(`Retrying API call. Retry count: ${retryCount}`);
                }
            }
        } while (retryCount >= 0)
    });
}

async function _sendReport(data: Object): Promise<Object> {
    return new Promise(async (resolve, reject) => {
        let apiTime = new Date().getMilliseconds();
        var bearerToken = await core.getIDToken();
        let url: string = "";
        let options = {
            method: 'POST',
            timeout: 2500,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + bearerToken
            },
            data: data
        };
        core.debug(`${options['method'].toUpperCase()} ${url}`);

        const req = https.request(url, options, (res) => {
            let resData = '';
            res.on('data', (chunk) => {
                resData += chunk.toString();
            });

            res.on('end', () => {
                core.debug("API calls finished. Time taken: " + (new Date().getMilliseconds() - apiTime) + "ms");
                resolve(resData);
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Error calling url: ${error}`));
        });
        
        req.end();
    });
}

function getOptions(buffer: Buffer): exec.ExecOptions {
    var options = {
        listeners: {
            stdout: (data: Buffer) => {
                buffer = Buffer.concat([buffer, data]);
                console.log("Buffer: " + buffer.toString());
            },
            stderr: (data: Buffer) => {
                buffer = Buffer.concat([buffer, data]);
            }
        }
    };
    return options;
}

run().catch((error) => {
    core.debug(error);
});