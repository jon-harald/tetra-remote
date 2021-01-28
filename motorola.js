const SerialPort = require("serialport");
const Readline = SerialPort.parsers.Readline;
const axios = require("axios");
const config = require("./config.json");
const delay = require("delay");

DEBUG = process.env.DEBUG || false;
console.log("Debug: " + DEBUG);
const port = new SerialPort(config.radio.device, {
  baudRate: config.radio.baudrate,
});

const parser = new Readline();
port.pipe(parser);

let signalUpdate = true;
let activeTalkgroup = null;
let activeSender = null;
let timestampTxStart = null;

// Radio
let radioIssi = null;
let radioBatteryLevel = null;
let radioRssi = null;
let radioVolume = null;
let radioGssi = null;
const serialCommandDelay = 500;

// Initialize radio
initializeRadio();

// Get status from radio at intervals
if (signalUpdate == true) {
  setInterval(async function () {
    getRadioStatus();
  }, 10000);
}

port.on("open", function () {
  console.log("Port open");
});

port.on("close", function () {
  console.log("Port closed");
  process.exit(1);
});

port.on("error", function (err) {
  console.log("Unhandled error: ", err.message);
  process.exit(1);
});

parser.on("error", function (err) {
  console.log("Unhandled parser error " + err);
});

parser.on("data", function (data) {
  if (data.substr(0, 6) === "+CSQ: ") {
    radioRssi = data.substr(6).split(",")[0].trimEnd();
  } else if (data.substr(0, 6) === "+CBC: ") {
    radioBatteryLevel = data.substr(6).split(",")[1].trimEnd();
  } else if (data.substr(0, 7) === "+CLVL: ") {
    radioVolume = data.substr(7).trimEnd();
  } else if (data.substr(0, 8) === "+CNUMF: ") {
    radioIssi = data.substr(-8).trimEnd();
  } else if (data.substr(0, 8) === "+CNUMF: ") {
    radioIssi = data.substr(-8).trimEnd();
  } else if (data.substr(0, 7) === "+CTGS: ") {
    radioGssi = data.substr(7).split(",")[1].trimEnd();
  } else if (data.substr(0, 8) === "+CTICN: ") {
    callSetup(data.substr(8));
  } else if (data.substr(0, 7) === "+CTXG: ") {
    transmissionStart(data.substr(7));
  } else if (data.substr(0, 7) === "+CTCC: ") {
    DEBUG && console.log("Call connected: " + data.substr(7));
  } else if (data.substr(0, 8) === "+CDTXC: ") {
    transmissionEnd(data.substr(8));
  } else if (data.substr(0, 7) === "+CTCR: ") {
    callEnd(data.substr(7));
  } else if (data.substr(0, 7) === "+CPIN: ") {
    if (data.substr(7).trimEnd() == "MT PIN-UNLOCKED") {
      console.log("PIN unlocked");
    } else {
      console.log("PIN locked");
      (async () => {
        port.write("AT+CPIN=" + config.radio.pinCode + "\r\n", function (err) {
          if (err) {
            console.log("Error on write: " + err);
          }
        });
        await delay(serialCommandDelay);
      })();
    }
  } else if (data.substr(0, 2) === "OK") {
  } else if (data.substr(0, 1) === "\n") {
  } else if (data.substr(0, 1) === "\r") {
  } else {
    DEBUG && console.log("Unhandled data:", data);
  }
});

function callSetup(data) {
  // 1,0,0,0,6101629,1,1,0,1,1,0,4037009,0
  let params = data.split(",");
  let sender = params[4];
  let talkgroup = params[11];
  activeTalkgroup = talkgroup;
  DEBUG &&
    console.log("Incoming call from " + sender + " in talkgroup " + talkgroup);

  const requestData = {
    issi: "0000000",
    gssi: activeTalkgroup,
    event: "GROUPOPEN",
    timestamp: Math.floor(Date.now() / 1000),
  };

  axios({
    method: "post",
    url: config.server.url,
    data: requestData,
    headers: {
      "X-AUTH-TOKEN": config.server.token,
      "User-Agent": "tetra-remote/0.1",
    },
  })
    .then((res) => {})
    .catch((err) => {
      console.log("Error sending data: " + err);
    });
}

function callEnd(data) {
  let params = data.split(",");

  DEBUG && console.log("Call ended in talkgroup  " + activeTalkgroup);

  const requestData = {
    issi: "0000000",
    gssi: activeTalkgroup,
    event: "GROUPCLOSED",
    timestamp: Math.floor(Date.now() / 1000),
  };

  axios({
    method: "post",
    url: config.server.url,
    data: requestData,
    headers: {
      "X-AUTH-TOKEN": config.server.token,
      "User-Agent": "tetra-remote/0.1",
    },
  })
    .then((res) => {})
    .catch((err) => {
      console.log("Error sending data: " + err);
    });

  activeTalkgroup = null;
}

function transmissionStart(data) {
  // 2,3,0,0,0,6101629
  timestampTxStart = Date.now();
  let params = data.split(",");

  let sender = params[5].trimEnd();
  activeSender = sender;
  DEBUG && console.log("Transmission grant: " + sender);

  const requestData = {
    issi: activeSender,
    gssi: activeTalkgroup,
    event: "TXSTART",
    timestamp: Math.floor(Date.now() / 1000),
  };

  axios({
    method: "post",
    url: config.server.url,
    data: requestData,
    headers: {
      "X-AUTH-TOKEN": config.server.token,
      "User-Agent": "tetra-remote/0.1",
    },
  })
    .then((res) => {})
    .catch((err) => {
      console.log("Error sending data " + err);
    });
}

function transmissionEnd(data) {
  // 3,0
  elapsedTime = Date.now() - timestampTxStart;

  let params = data.split(",");

  DEBUG && console.log("Transmission ended: " + activeSender);
  DEBUG &&
    console.log(
      "Elapsed time: " + (elapsedTime / 1000).toFixed(1) + " sekunder"
    );
  const requestData = {
    issi: activeSender,
    gssi: activeTalkgroup,
    event: "TXEND",
    timestamp: Math.floor(Date.now() / 1000),
    txtime: (elapsedTime / 1000).toFixed(1),
  };

  axios({
    method: "post",
    url: config.server.url,
    data: requestData,
    headers: {
      "X-AUTH-TOKEN": config.server.token,
      "User-Agent": "tetra-remote/0.1",
    },
  })
    .then((res) => {
      DEBUG && console.log(`Status: ${res.status}`);
    })
    .catch((err) => {
      console.log("Error sending data " + err);
    });

  activeSender = null;
}

function sendStatus() {
  const requestData = {
    issi: radioIssi,
    gssi: radioGssi,
    rssi: radioRssi,
    battery: radioBatteryLevel,
    timestamp: Math.floor(Date.now() / 1000),
    volume: radioVolume,
    event: "RADIOSTATUS",
  };

  DEBUG && console.log("-- Sending status --");
  DEBUG && console.log(requestData);
  DEBUG && console.log("\n");

  axios({
    method: "post",
    url: config.server.url,
    data: requestData,
    headers: {
      "X-AUTH-TOKEN": config.server.token,
      "User-Agent": "tetra-remote/0.1",
    },
  })
    .then((res) => {})
    .catch((err) => {
      console.log("Error sending data " + err);
    });
}

async function getRadioStatus() {
  //Get signal strength
  port.write("AT+CSQ?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  //Get battery
  port.write("AT+CBC?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Get volume level
  port.write("AT+CLVL?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Get current talkgroup
  port.write("AT+CTGS?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  sendStatus();
}

async function initializeRadio() {
  // Disable echo
  port.write("ATE0\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Get PIN status (unlock in response)
  port.write("AT+CPIN?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);
  // Get manufacturer
  port.write("AT+GMI?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Get radio model -
  // TODO: Check for Motorola
  port.write("AT+GMM?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Get radio ID (ISSI)
  port.write("AT+CNUMF?\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Register for call control
  port.write("AT+CTSP=2,0,0\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);

  // Register for talkgroup control
  port.write("AT+CTSP=1,1,11\r\n", function (err) {
    if (err) {
      console.log("Error on write: " + err);
    }
  });
  await delay(serialCommandDelay);
}
