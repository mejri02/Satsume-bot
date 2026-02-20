const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { ethers } = require('ethers');

const BASE_URL = 'https://api.satsume.com';
const SEPOLIA_RPC = 'https://sepolia.drpc.org';
const NUSD_CONTRACT = '0xcF10A5FB2fF625Dfed3E513221650fE6b04d51Be';

const ENDPOINTS = {
    loginNonce: '/auth/users/login/nonce',
    login: '/auth/users/login',
    userCurrent: '/auth/users/current',
    userInfo: '/points/accounts/user/info',
    checkin: '/points/checkin/perform',
    checkinCalendar: '/points/checkin/calendar/7',
    createOrder: '/product/orders',
    payOrder: '/product/orders/pay/v2',
    activityLog: '/points/activity/createLog',
    submitReview: '/product/product/review',
    productList: '/product/product/page-for-buyer',
    productDetail: '/product/product',
    submitOrder: '/blockchain/scan/submitOrder',
    ordersList: '/product/orders/page/for/user'
};

const RECAPTCHA_SITE_KEY = '6LdNNtMrAAAAAMEQUOEq3UzU-fCmMuhsYtkD36Xc';
const RECAPTCHA_SITE_URL = 'https://satsume.com';

const DELAYS = {
    minDelay: 2000,
    maxDelay: 5000,
    taskDelay: 8000,
    microPause: 500
};

const RETRY = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    taskRetryCount: 3,
    cycleRetryCount: 5
};

const SCHEDULE_RESET_HOUR_UTC = 0;
const LOG_LIMIT = 15;
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const FINGERPRINT_FILE = path.join(__dirname, 'device_fingerprints.json');

const PAYMENT_ABI = [
    'function purchaseWithMarketingAndPermit(uint256 _orderId, uint256 _skuId, uint256 _price, uint256 _inventory, uint256 _inventoryVersion, uint256 _quantity, uint256 _totalAmount, uint256 _shippingFee, uint256 _deadline, uint256 _nonce, uint256 _marketingRuleId, uint8 _os_v, bytes32 _os_r, bytes32 _os_s, uint8 _v, bytes32 _r, bytes32 _s) external'
];

const NUSD_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function nonces(address) view returns (uint256)',
    'function name() view returns (string)',
    'function dailyMint() external',
    'function claimDailyTokens() external',
    'function faucet() external',
    'function mint() external',
    'event DailyMint(address indexed user, uint256 amount, uint256 day)'
];

const NUSD_PERMIT_DOMAIN = {
    name: 'Neuroshards',
    version: '1',
    chainId: 11155111,
    verifyingContract: NUSD_CONTRACT
};

const PERMIT_TYPES = {
    Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
    ]
};

let _nusdNameCache = null;

const REVIEW_TEMPLATES = [
    'Great product! Fast shipping and excellent quality.',
    'Very satisfied with my purchase. Highly recommended!',
    'Good quality, exactly as described. Will buy again.',
    'Amazing product! Exceeded my expectations.',
    'Perfect! Exactly what I was looking for.',
    'Excellent service and product quality. 5 stars!',
    'Very happy with this purchase. Thank you!',
    'Product arrived quickly and works perfectly.',
    'Great value for money. Highly recommend!',
    'Superb quality and fast delivery. Love it!',
    'Nice product, good packaging too. Thanks!',
    'Really impressed with the quality. Would order again.',
    'goood welll',
    'Awesome product, very recommended!',
    'Love it! Great experience overall.',
    'Smooth transaction and great product. Thanks seller!',
    'Top notch quality. 5 stars from me!',
    'Very nice, exactly what I expected.',
    'Fantastic purchase! Super happy with it.',
    'Good stuff, fast and reliable. Thanks!'
];

const DESKTOP_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

const CLIENT_HINTS_MAP = {
    'Windows': { platform: '"Windows"', brands: '"Not A(Brand";v="99", "Google Chrome";v="122", "Chromium";v="122"' },
    'Macintosh': { platform: '"macOS"', brands: '"Not A(Brand";v="99", "Google Chrome";v="122", "Chromium";v="122"' },
    'Linux': { platform: '"Linux"', brands: '"Not A(Brand";v="99", "Google Chrome";v="122", "Chromium";v="122"' }
};

const state = {
    accounts: [],
    logs: [],
    isRunning: true
};

function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}h ${m}m ${s}s`;
}

function logToState(msg) {
    const timestamp = new Date().toLocaleTimeString();
    state.logs.push(`${chalk.gray(`[${timestamp}]`)} ${msg}`);
    if (state.logs.length > LOG_LIMIT) {
        state.logs.shift();
    }
}

const logger = {
    info: (msg, options = {}) => {
        const emoji = options.emoji || 'ℹ️ ';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${msg}`);
        renderTable();
    },
    success: (msg, options = {}) => {
        const emoji = options.emoji || '✅';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${chalk.green(msg)}`);
        renderTable();
    },
    warn: (msg, options = {}) => {
        const emoji = options.emoji || '⚠️ ';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${chalk.yellow(msg)}`);
        renderTable();
    },
    error: (msg, options = {}) => {
        const emoji = options.emoji || '❌';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${chalk.red(msg)}`);
        renderTable();
    }
};

function renderTable() {
    console.clear();

    console.log(chalk.blue(`
               / \\
              /   \\
             |  |  |
             |  |  |
              \\  \\
             |  |  |
             |  |  |
              \\   /
               \\ /
    `));
    console.log(chalk.bold.cyan('    ======MEJRI02 AIRDROP======'));
    console.log(chalk.bold.cyan('  =====MEJRI02 SATSUME V1.0====='));
    console.log('');

    const table = new Table({
        head: ['Account', 'IP', 'Status', 'Last Run', 'Next Run', 'Checkin', 'Faucet', 'Purchase', 'Review'],
        colWidths: [12, 18, 12, 12, 12, 10, 10, 10, 10],
        style: { head: ['cyan'], border: ['grey'] }
    });

    state.accounts.forEach(acc => {
        let statusText = acc.status;
        if (acc.status === 'SUCCESS') statusText = chalk.green(acc.status);
        else if (acc.status === 'FAILED') statusText = chalk.red(acc.status);
        else if (acc.status === 'PROCESSING') statusText = chalk.yellow(acc.status);
        else if (acc.status === 'WAITING') statusText = chalk.blue(acc.status);

        let nextRunStr = '-';
        if (acc.nextRun) {
            const diff = acc.nextRun - Date.now();
            if (diff > 0) nextRunStr = formatDuration(diff);
            else nextRunStr = 'Ready Now';
        }

        let lastRunStr = '-';
        if (acc.lastRun) {
            lastRunStr = new Date(acc.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        table.push([
            `Account ${acc.index}`,
            chalk.magenta(acc.ip || 'Direct'),
            statusText,
            lastRunStr,
            nextRunStr,
            acc.checkin || '-',
            acc.faucet || '-',
            acc.purchase || '-',
            acc.review || '-'
        ]);
    });

    console.log(table.toString());

    console.log(chalk.yellow(' EXECUTION LOGS:'));
    state.logs.forEach(log => console.log(log));
    console.log(chalk.bold.cyan('='.repeat(106)));
}

async function delay(ms, variance = 0.3) {
    const min = ms * (1 - variance);
    const max = ms * (1 + variance);
    const actual = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, actual));
}

async function microPause() {
    const pauseMs = Math.floor(Math.random() * DELAYS.microPause) + 100;
    return new Promise(resolve => setTimeout(resolve, pauseMs));
}

function getRandomReview() {
    return REVIEW_TEMPLATES[Math.floor(Math.random() * REVIEW_TEMPLATES.length)];
}

function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function loadFingerprints() {
    try {
        if (fs.existsSync(FINGERPRINT_FILE)) {
            return JSON.parse(fs.readFileSync(FINGERPRINT_FILE, 'utf8'));
        }
    } catch (e) { }
    return {};
}

function saveFingerprints(fingerprints) {
    fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(fingerprints, null, 2));
}

function generateFingerprint(walletAddress) {
    const seed = crypto.createHash('sha256').update(walletAddress.toLowerCase()).digest('hex');
    const uaIndex = parseInt(seed.substring(0, 8), 16) % DESKTOP_USER_AGENTS.length;
    const userAgent = DESKTOP_USER_AGENTS[uaIndex];

    let platform = 'Windows';
    if (userAgent.includes('Macintosh')) platform = 'Macintosh';
    else if (userAgent.includes('Linux')) platform = 'Linux';

    const clientHints = CLIENT_HINTS_MAP[platform];
    const canvasHash = crypto.createHash('md5').update(seed + 'canvas').digest('hex');
    const webglHash = crypto.createHash('md5').update(seed + 'webgl').digest('hex');

    const resolutions = ['1920x1080', '2560x1440', '1366x768', '1440x900', '1536x864'];
    const resIndex = parseInt(seed.substring(8, 16), 16) % resolutions.length;

    const timezones = [-480, -420, -360, -300, -240, 0, 60, 120, 420, 480, 540];
    const tzIndex = parseInt(seed.substring(16, 24), 16) % timezones.length;

    return {
        userAgent, platform,
        clientHints: {
            'sec-ch-ua': clientHints.brands,
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': clientHints.platform
        },
        canvasHash, webglHash,
        screenResolution: resolutions[resIndex],
        timezoneOffset: timezones[tzIndex],
        language: 'en-US',
        languages: ['en-US', 'en'],
        colorDepth: 24,
        hardwareConcurrency: [4, 8, 12, 16][parseInt(seed.substring(24, 32), 16) % 4],
        deviceMemory: [4, 8, 16, 32][parseInt(seed.substring(32, 40), 16) % 4],
        createdAt: new Date().toISOString()
    };
}

function getFingerprint(walletAddress) {
    const fingerprints = loadFingerprints();
    const key = walletAddress.toLowerCase();
    if (!fingerprints[key]) {
        fingerprints[key] = generateFingerprint(walletAddress);
        saveFingerprints(fingerprints);
    }
    return fingerprints[key];
}

function buildHeaders(fingerprint, accessToken = null) {
    const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': `${fingerprint.language},en;q=0.9`,
        'content-type': 'application/json',
        'origin': 'https://satsume.com',
        'referer': 'https://satsume.com/',
        'user-agent': fingerprint.userAgent,
        'sec-ch-ua': fingerprint.clientHints['sec-ch-ua'],
        'sec-ch-ua-mobile': fingerprint.clientHints['sec-ch-ua-mobile'],
        'sec-ch-ua-platform': fingerprint.clientHints['sec-ch-ua-platform'],
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site'
    };
    if (accessToken) headers['x-access-token'] = accessToken;
    return headers;
}

function createProxyAgent(proxyString) {
    if (!proxyString) return null;
    try {
        if (proxyString.startsWith('socks')) return new SocksProxyAgent(proxyString);
        return new HttpsProxyAgent(proxyString);
    } catch (e) { return null; }
}

function getBackoffDelay(attempt) {
    const d = Math.min(RETRY.baseDelay * Math.pow(2, attempt), RETRY.maxDelay);
    return d + Math.random() * d * 0.1;
}

class ApiClient {
    constructor(fingerprint, proxy = null, captchaApiKey = null) {
        this.fingerprint = fingerprint;
        this.accessToken = null;
        this.proxyAgent = createProxyAgent(proxy);
        this.proxyString = proxy || '';
        this.captchaApiKey = captchaApiKey;
    }

    setAccessToken(token) { this.accessToken = token; }
    getHeaders() { return buildHeaders(this.fingerprint, this.accessToken); }

    async request(method, endpoint, data = null, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        const maxRetries = options.maxRetries ?? RETRY.maxRetries;
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await microPause();
                const reqConfig = {
                    method, url,
                    headers: this.getHeaders(),
                    timeout: 30000,
                    transformResponse: [(data) => {
                        if (typeof data === 'string') {
                            try {
                                const transformed = data.replace(/:(\d{16,})/g, ':"$1"');
                                return JSON.parse(transformed);
                            } catch (e) { return data; }
                        }
                        return data;
                    }]
                };
                if (data) reqConfig.data = data;
                if (this.proxyAgent) {
                    reqConfig.httpsAgent = this.proxyAgent;
                    reqConfig.httpAgent = this.proxyAgent;
                }
                const response = await axios(reqConfig);
                await delay(DELAYS.minDelay);
                return response.data;
            } catch (error) {
                lastError = error;
                if (error.response?.status === 401 || error.response?.status === 403) {
                    if (options.onAuthError) {
                        const refreshed = await options.onAuthError();
                        if (refreshed) continue;
                    }
                }
                const isRetryable = !error.response || error.response.status >= 500 ||
                    error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
                if (isRetryable && attempt < maxRetries) {
                    const backoff = getBackoffDelay(attempt);
                    await delay(backoff, 0);
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    async get(endpoint, options = {}) { return this.request('GET', endpoint, null, options); }
    async post(endpoint, data = {}, options = {}) { return this.request('POST', endpoint, data, options); }
}

async function warmupRequests(client) {
    try {
        await delay(DELAYS.minDelay);
        await client.get(ENDPOINTS.userInfo);
        await delay(DELAYS.minDelay);
        await client.get(ENDPOINTS.checkinCalendar);
    } catch (e) { }
}

function loadTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    } catch (e) { }
    return {};
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function isTokenExpired(tokenData) {
    if (!tokenData || !tokenData.expiresAt) return true;
    return Date.now() >= (tokenData.expiresAt - 3600000);
}

function parseJwtExpiry(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload.exp ? payload.exp * 1000 : null;
    } catch (e) { return null; }
}

function parseJwtUserId(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload.userId || null;
    } catch (e) { return null; }
}

function getWalletAddress(privateKey) {
    return new ethers.Wallet(privateKey).address;
}

async function solveCaptcha(apiKey, siteKey, pageUrl) {
    try {
        logger.info('Solving CAPTCHA with 2Captcha...', { context: 'Captcha' });

        const submitUrl = `http://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${pageUrl}&json=1`;
        const submitRes = await axios.get(submitUrl);

        if (submitRes.data.status !== 1) {
            logger.error(`2Captcha submit failed: ${submitRes.data.request}`, { context: 'Captcha' });
            return null;
        }

        const requestId = submitRes.data.request;
        logger.info(`Captcha submitted. ID: ${requestId}. Waiting...`, { context: 'Captcha' });

        let attempts = 0;
        while (attempts < 30) {
            await delay(5000);
            const fetchUrl = `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${requestId}&json=1`;
            const fetchRes = await axios.get(fetchUrl);

            if (fetchRes.data.status === 1) {
                logger.success('Captcha solved!', { context: 'Captcha' });
                return fetchRes.data.request;
            }

            if (fetchRes.data.request !== 'CAPCHA_NOT_READY') {
                logger.error(`2Captcha error: ${fetchRes.data.request}`, { context: 'Captcha' });
                return null;
            }

            attempts++;
        }

        logger.error('Captcha timeout', { context: 'Captcha' });
        return null;
    } catch (e) {
        logger.error(`Captcha exception: ${e.message}`, { context: 'Captcha' });
        return null;
    }
}

async function fetchRecaptchaToken(proxy = null) {
    try {
        const co = Buffer.from(`${RECAPTCHA_SITE_URL}:443`).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

        const agentConfig = {};
        if (proxy) {
            const agent = createProxyAgent(proxy);
            if (agent) { agentConfig.httpsAgent = agent; agentConfig.httpAgent = agent; }
        }

        const anchorUrl = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&v=gYdqkxiddE5aXrugNbBbKgtN&size=invisible&cb=${Date.now()}`;
        const anchorRes = await axios.get(anchorUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            timeout: 15000,
            ...agentConfig
        });

        const tokenMatch = anchorRes.data.match(/recaptcha-token[^>]*value="([^"]+)"/);
        if (!tokenMatch) return null;
        const initialToken = tokenMatch[1];

        const reloadUrl = `https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITE_KEY}`;
        const reloadRes = await axios.post(reloadUrl,
            `v=gYdqkxiddE5aXrugNbBbKgtN&reason=q&c=${encodeURIComponent(initialToken)}&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&size=invisible`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Referer': `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&v=gYdqkxiddE5aXrugNbBbKgtN&size=invisible`
                },
                timeout: 15000,
                ...agentConfig
            }
        );

        const rTokenMatch = reloadRes.data.match(/rresp","([^"]+)"/);
        if (rTokenMatch) return rTokenMatch[1];

        const altMatch = reloadRes.data.match(/"rresp","([^"]+)"/);
        if (altMatch) return altMatch[1];

        return null;
    } catch (e) {
        return null;
    }
}

async function getNonce(apiClient, address, proxy = null) {
    const captchaToken = await fetchRecaptchaToken(proxy);
    if (captchaToken) {
        try {
            const endpoint = `${ENDPOINTS.loginNonce}?address=${address}&token=${encodeURIComponent(captchaToken)}`;
            const response = await apiClient.get(endpoint, { maxRetries: 1 });
            if (response && response.code === 200 && response.data) {
                return { success: true, nonce: response.data.nonce || response.data };
            }
        } catch (e) { }
    }

    try {
        const endpoint = `${ENDPOINTS.loginNonce}?address=${address}`;
        const response = await apiClient.get(endpoint, { maxRetries: 1 });
        if (response && response.code === 200 && response.data) {
            return { success: true, nonce: response.data.nonce || response.data };
        }
    } catch (e) { }

    try {
        const endpoint = `${ENDPOINTS.loginNonce}?address=${address}&token=`;
        const response = await apiClient.get(endpoint, { maxRetries: 1 });
        if (response && response.code === 200 && response.data) {
            return { success: true, nonce: response.data.nonce || response.data };
        }
    } catch (e) { }

    if (apiClient.captchaApiKey) {
        const solvedToken = await solveCaptcha(apiClient.captchaApiKey, RECAPTCHA_SITE_KEY, RECAPTCHA_SITE_URL);
        if (solvedToken) {
            try {
                const endpoint = `${ENDPOINTS.loginNonce}?address=${address}&token=${encodeURIComponent(solvedToken)}`;
                const response = await apiClient.get(endpoint, { maxRetries: 2 });
                if (response && response.code === 200 && response.data) {
                    return { success: true, nonce: response.data.nonce || response.data };
                }
            } catch (e) {
                logger.error(`Login with 2Captcha failed: ${e.message}`, { context: 'Login' });
            }
        }
    }

    return { success: false, error: 'Failed to obtain nonce (captcha required and failed)' };
}

async function login(apiClient, privateKey, proxy = null) {
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;
    const tokens = loadTokens();
    const tokenKey = address.toLowerCase();

    if (tokens[tokenKey] && !isTokenExpired(tokens[tokenKey])) {
        apiClient.setAccessToken(tokens[tokenKey].accessToken);
        return { success: true, cached: true, address, userId: tokens[tokenKey].userId };
    }

    try {
        const nonceResult = await getNonce(apiClient, address, proxy);
        if (!nonceResult.success) {
            return { success: false, error: nonceResult.error, address };
        }
        const nonce = nonceResult.nonce;

        const message = `Please sign to login to your Satsume account, address: ${address.toLowerCase()}, nonce: ${nonce}`;
        const signature = await wallet.signMessage(message);

        const loginResponse = await apiClient.post(ENDPOINTS.login, {
            address: address,
            message: message,
            signature: signature,
            inviteId: ''
        });

        if (loginResponse.code === 200 && loginResponse.data) {
            const accessToken = loginResponse.data.accessToken || loginResponse.data.token;
            if (accessToken) {
                const expiresAt = parseJwtExpiry(accessToken);
                const userId = parseJwtUserId(accessToken);
                tokens[tokenKey] = { accessToken, userId, expiresAt: expiresAt || (Date.now() + 86400000), createdAt: new Date().toISOString() };
                saveTokens(tokens);
                apiClient.setAccessToken(accessToken);
                return { success: true, cached: false, address, userId };
            }
        }
        return { success: false, error: loginResponse.message || 'Login failed - no token received', address };
    } catch (error) {
        const errMsg = error.response?.data?.message || error.response?.data?.reason || error.message;
        return { success: false, error: errMsg, address };
    }
}

async function getUserPoints(apiClient) {
    try {
        const response = await apiClient.get(ENDPOINTS.userInfo);
        if (response.code === 200 && response.data) {
            return { success: true, points: response.data.points || 0 };
        }
        return { success: false, error: response.message || 'Failed to fetch points' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function performCheckin(apiClient) {
    try {
        const response = await apiClient.post(ENDPOINTS.checkin, {});

        if (response.code === 200) {
            const data = response.data || {};
            return {
                success: true,
                pointsEarned: data.pointsEarned || data.points || 0,
                consecutiveDays: data.consecutiveDays || data.streak || 0,
                message: 'Check-in successful'
            };
        }

        if (response.code === 400 || (response.message && (
            response.message.toLowerCase().includes('already') ||
            response.message.toLowerCase().includes('checked') ||
            response.message.toLowerCase().includes('today') ||
            response.message.toLowerCase().includes('done')
        ))) {
            return {
                success: true,
                alreadyDone: true,
                pointsEarned: 0,
                message: 'Already checked in today'
            };
        }

        return { success: false, error: response.message || 'Check-in failed' };
    } catch (error) {
        const errMsg = error.response?.data?.message || error.message || '';
        if (errMsg.toLowerCase().includes('already') || errMsg.toLowerCase().includes('checked') || errMsg.toLowerCase().includes('today')) {
            return { success: true, alreadyDone: true, pointsEarned: 0, message: 'Already checked in today' };
        }
        return { success: false, error: errMsg };
    }
}

function createSigner(privateKey) {
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    return new ethers.Wallet(privateKey, provider);
}

async function getNusdBalance(address) {
    try {
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
        const contract = new ethers.Contract(NUSD_CONTRACT, NUSD_ABI, provider);
        const balance = await contract.balanceOf(address);
        return parseFloat(ethers.formatEther(balance));
    } catch (error) { return 0; }
}

async function performFaucetClaim(privateKey) {
    try {
        const signer = createSigner(privateKey);
        const address = await signer.getAddress();
        const balanceBefore = await getNusdBalance(address);
        const contract = new ethers.Contract(NUSD_CONTRACT, NUSD_ABI, signer);

        let tx;
        let functionUsed = '';
        let lastFaucetError = '';
        const functions = ['dailyMint', 'claimDailyTokens', 'faucet', 'mint'];

        for (const funcName of functions) {
            try {
                if (contract[funcName]) {
                    tx = await contract[funcName]();
                    functionUsed = funcName;
                    break;
                }
            } catch (e) {
                const errMsg = e.reason || e.shortMessage || e.message || '';
                lastFaucetError = errMsg;
                if (errMsg.toLowerCase().includes('already') || errMsg.toLowerCase().includes('minted today') ||
                    errMsg.toLowerCase().includes('once per day') || errMsg.toLowerCase().includes('reverted')) {
                    return { success: true, alreadyDone: true, message: 'Already claimed NUSD today' };
                }
                continue;
            }
        }

        if (!tx) return { success: false, error: lastFaucetError || 'Could not find faucet function' };

        const receipt = await tx.wait();
        const balanceAfter = await getNusdBalance(address);
        const claimed = parseFloat(balanceAfter) - parseFloat(balanceBefore);

        return {
            success: true,
            txHash: receipt.hash,
            claimed: claimed.toFixed(0),
            balanceAfter,
            function: functionUsed,
            message: `Claimed ${claimed.toFixed(0)} NUSD`
        };
    } catch (error) {
        const errorMsg = error.message || '';

        if (errorMsg.includes('already claimed') ||
            errorMsg.includes('once per day') ||
            errorMsg.includes('execution reverted') ||
            errorMsg.includes('DailyMint') ||
            error.shortMessage?.includes('reverted')) {
            return {
                success: true,
                alreadyDone: true,
                message: 'Already claimed NUSD today'
            };
        }

        if (errorMsg.includes('insufficient funds')) {
            return { success: false, error: 'Insufficient gas (need Sepolia ETH)' };
        }

        return { success: false, error: error.shortMessage || error.message };
    }
}

async function fetchProductList(apiClient) {
    try {
        const response = await apiClient.get(`${ENDPOINTS.productList}?page=0&size=50&sort=,desc`);
        if (response.code !== 200 || !response.data || !response.data.content) {
            return { success: false, error: response.message || 'Failed to fetch products' };
        }
        const products = response.data.content
            .filter(p => p.status === 2 && p.stockQuantity > 0)
            .map(p => ({
                id: p.id?.toString() || p.id,
                name: p.name,
                price: parseInt(p.originalPrice) || 0,
                stock: p.stockQuantity,
                symbol: p.symbol,
                storeName: p.storeName
            }))
            .filter(p => p.price > 0);
        products.sort((a, b) => a.price - b.price);
        return { success: true, products };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function fetchProductDetail(apiClient, productId) {
    try {
        const response = await apiClient.get(`${ENDPOINTS.productDetail}/${productId}`);
        if (response.code !== 200 || !response.data) return { success: false, error: response.message || 'Product not found' };
        const skus = response.data.productSkus;
        if (!skus || skus.length === 0) return { success: false, error: 'No SKU available' };
        const validSku = skus.find(s => s.isEnabled !== false && (s.stock > 0 || s.stock === undefined));
        if (!validSku) return { success: false, error: 'No valid SKU in stock' };
        return { success: true, skuId: validSku.id?.toString() || validSku.id, skuPrice: parseInt(validSku.price) || 0, stock: validSku.stock, promotionId: response.data.promotionId || null };
    } catch (error) { return { success: false, error: error.message }; }
}

async function createOrder(apiClient, skuId, promotionId) {
    try {
        const payload = { skuId: skuId.toString(), quantity: 1, addressId: '', cartId: '' };
        if (promotionId) payload.promotionId = promotionId;
        const response = await apiClient.post(ENDPOINTS.createOrder, payload);
        if (response.code === 200 && response.data) return { success: true, orderId: response.data.toString() };
        return { success: false, error: response.message || response.reason || 'Failed to create order', code: response.code };
    } catch (error) { return { success: false, error: error.response?.data?.message || error.message }; }
}

async function getPaymentData(apiClient, orderId) {
    try {
        const response = await apiClient.post(ENDPOINTS.payOrder, { orderId: orderId.toString() });
        if (response.code === 200 && response.data) return { success: true, paymentData: response.data };
        return { success: false, error: response.message || response.reason || 'Failed to get payment data' };
    } catch (error) { return { success: false, error: error.response?.data?.message || error.message }; }
}

async function signNusdPermit(signer, spender, value, deadline) {
    const owner = await signer.getAddress();
    const nusdContract = new ethers.Contract(NUSD_CONTRACT, NUSD_ABI, signer.provider);

    let nonce, domainName;
    try {
        const namePromise = _nusdNameCache
            ? Promise.resolve(_nusdNameCache)
            : nusdContract.name().then(n => { _nusdNameCache = n; return n; });
        [nonce, domainName] = await Promise.all([
            nusdContract.nonces(owner),
            namePromise
        ]);
    } catch (e) {
        nonce = await nusdContract.nonces(owner);
        domainName = NUSD_PERMIT_DOMAIN.name;
    }

    const domain = { ...NUSD_PERMIT_DOMAIN, name: domainName };
    if (domainName !== NUSD_PERMIT_DOMAIN.name) {
        logger.warn(`NUSD domain name mismatch: contract="${domainName}" vs hardcoded="${NUSD_PERMIT_DOMAIN.name}". Using contract value.`, { context: 'Permit' });
    }

    const permitMessage = { owner, spender, value, nonce, deadline };
    const signature = await signer.signTypedData(domain, PERMIT_TYPES, permitMessage);
    const sig = ethers.Signature.from(signature);
    return { v: sig.v, r: sig.r, s: sig.s };
}

async function executePaymentOnChain(privateKey, paymentData, ctx) {
    try {
        const signer = createSigner(privateKey);
        const address = await signer.getAddress();
        const contractAddress = paymentData.address;
        const paymentContract = new ethers.Contract(contractAddress, PAYMENT_ABI, signer);

        let deadline;
        try {
            deadline = BigInt(paymentData.deadline);
        } catch {
            return { success: false, error: 'Invalid deadline in payment data' };
        }

        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        const deadlineSec = deadline > 10000000000n ? deadline / 1000n : deadline;
        const remainingSec = deadlineSec - nowSec;

        if (remainingSec <= 0n) {
            return { success: false, error: `Deadline already expired (${Number(-remainingSec)}s ago)` };
        }
        if (remainingSec < 60n) {
            return { success: false, error: `Deadline too close (${Number(remainingSec)}s left, need >60s)` };
        }

        const totalAmount = BigInt(paymentData.totalAmount);
        const nusdContract = new ethers.Contract(NUSD_CONTRACT, NUSD_ABI, signer.provider);
        const nusdBalance = await nusdContract.balanceOf(address);

        if (nusdBalance < totalAmount) {
            const have = ethers.formatEther(nusdBalance);
            const need = ethers.formatEther(totalAmount);
            return { success: false, error: `Insufficient NUSD: have ${have}, need ${need}` };
        }

        logger.info('Signing NUSD permit...', { context: ctx });
        const permitSig = await signNusdPermit(signer, contractAddress, totalAmount, deadline);

        const marketingRuleId = BigInt(paymentData.marketingRuleId || 0);
        const callParams = [
            BigInt(paymentData.orderId), BigInt(paymentData.skuId), BigInt(paymentData.price),
            BigInt(paymentData.inventory), BigInt(paymentData.inventoryVersion), BigInt(paymentData.quantity),
            totalAmount, BigInt(paymentData.shippingFee), deadline, BigInt(paymentData.nonce),
            marketingRuleId,
            paymentData.v, paymentData.r, paymentData.s,
            permitSig.v, permitSig.r, permitSig.s
        ];

        logger.info('Simulating transaction...', { context: ctx });
        try {
            await paymentContract.purchaseWithMarketingAndPermit.staticCall(...callParams);
        } catch (simError) {
            const reason = simError.revert?.args?.[0] || simError.reason || simError.shortMessage || simError.message;
            return { success: false, error: `Simulation failed: ${reason}` };
        }

        let gasLimit = 500000n;
        try {
            const estimated = await paymentContract.purchaseWithMarketingAndPermit.estimateGas(...callParams);
            gasLimit = estimated * 150n / 100n;
            if (gasLimit < 300000n) gasLimit = 300000n;
        } catch {
            gasLimit = 500000n;
        }

        logger.info('Sending on-chain transaction...', { context: ctx });
        const tx = await paymentContract.purchaseWithMarketingAndPermit(...callParams, { gasLimit });

        logger.info(`Tx sent: ${tx.hash.slice(0, 16)}... confirming...`, { context: ctx });

        const receipt = await Promise.race([
            tx.wait(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction confirmation timeout (120s)')), 120000))
        ]);

        if (receipt.status === 0) return { success: false, error: 'Transaction reverted on-chain' };
        return { success: true, txHash: receipt.hash };
    } catch (error) {
        const msg = error.shortMessage || error.reason || error.message || 'Unknown error';
        if (msg.includes('insufficient funds')) {
            return { success: false, error: 'Insufficient Sepolia ETH for gas fees' };
        }
        if (msg.includes('nonce')) {
            return { success: false, error: `Nonce conflict: ${msg}` };
        }
        return { success: false, error: msg };
    }
}

async function submitOrderTx(apiClient, orderId, txHash) {
    try {
        const response = await apiClient.post(ENDPOINTS.submitOrder, { orderId: orderId.toString(), txHash });
        return { success: response.code === 200 };
    } catch (error) { return { success: true }; }
}

async function logPurchaseActivity(apiClient, userId) {
    try { await apiClient.post(ENDPOINTS.activityLog, { path: '/order/submit', userId: userId.toString() }); } catch (e) { }
}

async function performPurchase(apiClient, userId, privateKey, ctx) {
    try {
        const wallet = new ethers.Wallet(privateKey);
        const address = wallet.address;
        const balanceNusd = await getNusdBalance(address);

        logger.info(`NUSD Balance: ${balanceNusd.toLocaleString()} NUSD`, { context: ctx });

        if (balanceNusd <= 0) return { success: false, error: 'No NUSD balance' };

        try {
            const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
            const ethBal = await provider.getBalance(address);
            const ethBalFormatted = parseFloat(ethers.formatEther(ethBal));
            logger.info(`Sepolia ETH: ${ethBalFormatted.toFixed(4)} ETH`, { context: ctx });
            if (ethBal < ethers.parseEther('0.0005')) {
                return { success: false, error: `Insufficient Sepolia ETH for gas: ${ethBalFormatted.toFixed(4)} ETH` };
            }
        } catch (e) {
            logger.warn(`Could not check ETH balance: ${e.message}`, { context: ctx });
        }

        logger.info('Fetching product list...', { context: ctx });
        const listResult = await fetchProductList(apiClient);
        if (!listResult.success) return { success: false, error: `Product list failed: ${listResult.error}` };

        const allProducts = listResult.products;
        logger.info(`Found ${allProducts.length} products`, { context: ctx });

        if (allProducts.length === 0) return { success: false, error: 'No products available' };

        const affordable = allProducts.filter(p => p.price <= balanceNusd);
        if (affordable.length === 0) {
            return { success: false, error: `Can't afford any product. Cheapest: ${allProducts[0].price} NUSD` };
        }

        const halfIdx = Math.max(1, Math.ceil(affordable.length * 0.5));
        const tryOrderFull = [...shuffleArray(affordable.slice(0, halfIdx)), ...affordable.slice(halfIdx)];
        const tryOrder = tryOrderFull.slice(0, 5);

        let lastError = '';
        let consecutiveOnChainFails = 0;
        const MAX_CONSECUTIVE_ONCHAIN_FAILS = 5;

        for (let i = 0; i < tryOrder.length; i++) {
            const product = tryOrder[i];
            logger.info(`[${i + 1}/${tryOrder.length}] Trying: ${product.name} (${product.price} NUSD)`, { context: ctx });

            try {
                const detailResult = await fetchProductDetail(apiClient, product.id);
                if (!detailResult.success) { lastError = detailResult.error; continue; }

                logger.info(`Creating order (SKU: ${detailResult.skuId})...`, { context: ctx });
                const orderResult = await createOrder(apiClient, detailResult.skuId, detailResult.promotionId);
                if (!orderResult.success) { lastError = orderResult.error; continue; }

                logger.info(`Order created: ${orderResult.orderId}`, { context: ctx });

                let onChainSuccess = false;
                let onChainResult;

                for (let attempt = 0; attempt < 2; attempt++) {
                    if (attempt > 0) {
                        logger.info(`Retrying on-chain payment (attempt ${attempt + 1})...`, { context: ctx });
                        await delay(3000);
                    }

                    const payResult = await getPaymentData(apiClient, orderResult.orderId);
                    if (!payResult.success) {
                        lastError = payResult.error;
                        break;
                    }

                    onChainResult = await executePaymentOnChain(privateKey, payResult.paymentData, ctx);
                    if (onChainResult.success) {
                        onChainSuccess = true;
                        break;
                    }

                    lastError = onChainResult.error;

                    if (lastError.includes('Insufficient NUSD') ||
                        lastError.includes('Insufficient Sepolia ETH') ||
                        lastError.includes('Deadline already expired') ||
                        lastError.includes('Invalid deadline')) {
                        break;
                    }
                }

                if (onChainSuccess) {
                    consecutiveOnChainFails = 0;
                    logger.success(`Tx confirmed: ${onChainResult.txHash.slice(0, 20)}...`, { context: ctx });
                    await submitOrderTx(apiClient, orderResult.orderId, onChainResult.txHash);
                    await logPurchaseActivity(apiClient, userId);

                    return {
                        success: true,
                        orderId: orderResult.orderId,
                        txHash: onChainResult.txHash,
                        product: product.name,
                        price: product.price,
                        message: `Bought "${product.name}" for ${product.price.toLocaleString()} NUSD`
                    };
                } else {
                    consecutiveOnChainFails++;
                    logger.warn(`On-chain failed [${consecutiveOnChainFails}/${MAX_CONSECUTIVE_ONCHAIN_FAILS}]: ${lastError}`, { context: ctx });

                    if (consecutiveOnChainFails >= MAX_CONSECUTIVE_ONCHAIN_FAILS) {
                        return { success: false, error: `${consecutiveOnChainFails} consecutive on-chain failures. Last: ${lastError}` };
                    }

                    if (lastError.includes('Insufficient NUSD') ||
                        lastError.includes('Insufficient Sepolia ETH')) {
                        return { success: false, error: lastError };
                    }
                }
            } catch (error) { lastError = error.message; continue; }
        }
        return { success: false, error: `All ${tryOrder.length} products failed. Last: ${lastError}` };
    } catch (error) { return { success: false, error: error.message }; }
}

async function getReviewableOrders(apiClient) {
    try {
        const response = await apiClient.get(`${ENDPOINTS.ordersList}?page=0&size=20&status=`);
        if (response.code !== 200 || !response.data) return { success: false, orders: [], error: response.message || 'Failed to fetch orders' };
        const allOrders = response.data.content || [];
        const reviewable = allOrders.filter(order => {
            const isPaid = order.status === 3 || order.status === '3';
            const notReviewed = !order.reviewId;
            return isPaid && notReviewed;
        });
        return { success: true, orders: reviewable, totalOrders: allOrders.length };
    } catch (error) { return { success: false, orders: [], error: error.message }; }
}

async function submitReview(apiClient, orderId, rating = 5, content = null) {
    try {
        const reviewContent = content || getRandomReview();
        const response = await apiClient.post(ENDPOINTS.submitReview, {
            orderId: orderId.toString(),
            rating: rating,
            content: reviewContent,
            isAnonymous: false
        });
        if (response.code === 200) return { success: true, message: `Review submitted: "${reviewContent.slice(0, 30)}..."` };
        return { success: false, error: response.message || 'Failed to submit review' };
    } catch (error) { return { success: false, error: error.response?.data?.message || error.message }; }
}

async function logReviewActivity(apiClient, userId) {
    try { await apiClient.post(ENDPOINTS.activityLog, { path: '/order/list', userId: userId.toString() }); } catch (e) { }
}

async function performReview(apiClient, userId, orderId, ctx) {
    try {
        let reviewedCount = 0;
        let lastMessage = '';

        if (orderId) {
            logger.info(`Reviewing just-purchased order: ${orderId}`, { context: ctx });
            await delay(2000);
            const result = await submitReview(apiClient, orderId, 5);
            if (result.success) {
                reviewedCount++;
                lastMessage = result.message;
                logger.success(result.message, { context: ctx });
                await logReviewActivity(apiClient, userId);
            } else {
                logger.warn(`Review failed: ${result.error}`, { context: ctx });
            }
        }

        logger.info('Checking for unreviewed orders...', { context: ctx });
        await delay(1500);
        const ordersResult = await getReviewableOrders(apiClient);

        if (!ordersResult.success) {
            if (reviewedCount > 0) return { success: true, reviewedCount, message: `Reviewed ${reviewedCount} order(s)` };
            return { success: false, error: `Fetch orders failed: ${ordersResult.error}` };
        }

        const pendingOrders = ordersResult.orders;
        logger.info(`Found ${pendingOrders.length} unreviewed orders`, { context: ctx });

        if (pendingOrders.length === 0 && reviewedCount === 0) {
            return { success: true, skipped: true, reviewedCount: 0, message: 'No orders pending review' };
        }

        for (const order of pendingOrders) {
            const oid = order.id?.toString() || order.id;
            if (orderId && oid === orderId.toString()) continue;

            const productName = order.snapshot?.productName || 'Unknown';
            logger.info(`Reviewing: ${productName}...`, { context: ctx });
            await delay(2000);

            const result = await submitReview(apiClient, oid, 5);
            if (result.success) {
                reviewedCount++;
                lastMessage = result.message;
                logger.success(result.message, { context: ctx });
                await logReviewActivity(apiClient, userId);
                await delay(1500);
            } else {
                logger.warn(`Review failed: ${result.error}`, { context: ctx });
            }
        }

        if (reviewedCount > 0) return { success: true, reviewedCount, message: `Reviewed ${reviewedCount} order(s). ${lastMessage}` };
        return { success: true, skipped: true, reviewedCount: 0, message: 'All orders already reviewed' };
    } catch (error) { return { success: false, error: error.message }; }
}

function loadAccounts() {
    const accountsPath = path.join(__dirname, 'accounts.txt');
    const proxiesPath = path.join(__dirname, 'proxy.txt');

    if (!fs.existsSync(accountsPath)) {
        console.log(chalk.red('accounts.txt not found!'));
        console.log(chalk.yellow('Please create accounts.txt with one private key per line'));
        process.exit(1);
    }

    try {
        const accountsContent = fs.readFileSync(accountsPath, 'utf8');
        const privateKeys = accountsContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        let proxies = [];
        if (fs.existsSync(proxiesPath)) {
            const proxiesContent = fs.readFileSync(proxiesPath, 'utf8');
            proxies = proxiesContent.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
        }

        const accounts = privateKeys.map((pk, index) => {
            let privateKey = pk.trim();
            if (!privateKey.startsWith('0x')) privateKey = '0x' + privateKey;
            
            const account = {
                privateKey: privateKey,
                proxy: proxies[index] || null
            };
            
            return account;
        }).filter(acc => {
            return acc.privateKey.length === 66;
        });

        if (accounts.length === 0) {
            console.log(chalk.red('No valid private keys found in accounts.txt'));
            process.exit(1);
        }

        console.log(chalk.green(`Loaded ${accounts.length} accounts from accounts.txt`));
        if (proxies.length > 0) {
            console.log(chalk.green(`Loaded ${proxies.length} proxies from proxy.txt`));
        }

        return accounts;
    } catch (e) {
        console.log(chalk.red('Failed to parse accounts.txt:'), e.message);
        process.exit(1);
    }
}

async function getPublicIp(proxy) {
    try {
        const config = { url: 'https://api.ipify.org?format=json', timeout: 10000 };
        if (proxy) {
            const agent = createProxyAgent(proxy);
            if (agent) { config.httpsAgent = agent; config.httpAgent = agent; }
        }
        const res = await axios(config);
        return res.data.ip || 'Unknown';
    } catch (e) { return 'Direct'; }
}

async function runAccountTasks(account, index) {
    const ctx = `Account ${index + 1}`;
    const accState = state.accounts[index];

    accState.status = 'PROCESSING';
    accState.checkin = '-';
    accState.faucet = '-';
    accState.purchase = '-';
    accState.review = '-';

    renderTable();

    let userId;

    try {
        const walletAddress = getWalletAddress(account.privateKey);
        logger.info(`Wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, { context: ctx });

        const fingerprint = getFingerprint(walletAddress);
        const apiClient = new ApiClient(fingerprint, account.proxy, null);

        logger.info('Logging in...', { context: ctx });
        const loginResult = await login(apiClient, account.privateKey, account.proxy);
        if (!loginResult.success) throw new Error(`Login failed: ${loginResult.error}`);

        userId = loginResult.userId;
        const loginType = loginResult.cached ? '(cached)' : '(fresh)';
        logger.success(`Login ${loginType} - ID: ${userId}`, { context: ctx });

        logger.info('Warming up...', { context: ctx });
        await warmupRequests(apiClient);

        renderTable();
        await delay(DELAYS.taskDelay);

        logger.info('Performing check-in...', { context: ctx });
        const checkinResult = await performCheckin(apiClient);

        if (checkinResult.success) {
            if (checkinResult.alreadyDone) {
                accState.checkin = chalk.yellow('ALREADY');
                logger.warn('Check-in: Already done today', { context: ctx });
            } else {
                accState.checkin = chalk.green('SUCCESS');
                logger.success(`Check-in: +${checkinResult.pointsEarned} pts`, { context: ctx });
            }
        } else {
            accState.checkin = chalk.red('FAILED');
            logger.error(`Check-in failed: ${checkinResult.error}`, { context: ctx });
        }
        renderTable();
        await delay(DELAYS.taskDelay);

        logger.info('Claiming NUSD faucet...', { context: ctx });
        const faucetResult = await performFaucetClaim(account.privateKey);

        if (faucetResult.success) {
            if (faucetResult.alreadyDone) {
                accState.faucet = chalk.yellow('ALREADY');
                logger.warn('Faucet: Already claimed today', { context: ctx });
            } else {
                accState.faucet = chalk.green('SUCCESS');
                logger.success(`Faucet: ${faucetResult.message}`, { context: ctx });
                if (faucetResult.txHash) logger.info(`Tx: ${faucetResult.txHash.slice(0, 20)}...`, { context: ctx });
            }
        } else {
            accState.faucet = chalk.red('FAILED');
            logger.error(`Faucet failed: ${faucetResult.error}`, { context: ctx });
        }
        renderTable();
        await delay(DELAYS.taskDelay);

        logger.info('Performing purchase...', { context: ctx });
        const purchaseResult = await performPurchase(apiClient, userId, account.privateKey, ctx);

        if (purchaseResult.success) {
            accState.purchase = chalk.green('SUCCESS');
            logger.success(`Purchase: ${purchaseResult.message}`, { context: ctx });
        } else {
            accState.purchase = chalk.red('FAILED');
            logger.error(`Purchase failed: ${purchaseResult.error}`, { context: ctx });
        }
        renderTable();
        await delay(DELAYS.taskDelay);

        logger.info('Submitting review...', { context: ctx });
        const reviewResult = await performReview(apiClient, userId, purchaseResult.orderId, ctx);

        if (reviewResult.success) {
            if (reviewResult.skipped) {
                accState.review = chalk.yellow('ALREADY');
                logger.warn('Review: No pending reviews', { context: ctx });
            } else {
                accState.review = chalk.green('SUCCESS');
                logger.success(`Review: ${reviewResult.message}`, { context: ctx });
            }
        } else {
            accState.review = chalk.red('FAILED');
            logger.error(`Review failed: ${reviewResult.error}`, { context: ctx });
        }

        accState.status = 'SUCCESS';
        accState.lastRun = Date.now();
        logger.success('All tasks completed!', { context: ctx });

    } catch (error) {
        accState.status = 'FAILED';
        accState.lastRun = Date.now();
        logger.error(`Error: ${error.message}`, { context: ctx });
        renderTable();
        return false;
    }

    renderTable();
    return true;
}

function getNextResetTime() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCHEDULE_RESET_HOUR_UTC, 0, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
}

async function main() {
    console.clear();
    console.log(chalk.cyan(`
    ╔══════════════════════════════════════════╗
    ║         MEJRI02 SATSUME BOT v1.0        ║
    ║         Load PK from accounts.txt        ║
    ║         Load Proxy from proxy.txt        ║
    ╚══════════════════════════════════════════╝
    `));

    const accounts = loadAccounts();

    for (let i = 0; i < accounts.length; i++) {
        const ip = accounts[i].proxy ? await getPublicIp(accounts[i].proxy) : 'Direct';
        state.accounts.push({
            index: i + 1,
            ip: ip,
            status: 'WAITING',
            lastRun: null,
            nextRun: null,
            checkin: '-',
            faucet: '-',
            purchase: '-',
            review: '-',
            points: '-',
            diffPoints: '-'
        });
    }

    renderTable();
    logger.info(`Loaded ${accounts.length} account(s) from accounts.txt`, { context: 'System' });

    while (true) {
        let cycleFailedAccounts = [];

        for (let i = 0; i < accounts.length; i++) {
            if (state.accounts[i].status === 'SUCCESS' && state.accounts[i].lastRun > Date.now() - 3600000) {
                continue;
            }

            state.accounts[i].status = 'PROCESSING';
            renderTable();

            const success = await runAccountTasks(accounts[i], i);
            if (!success) {
                cycleFailedAccounts.push(i);
            }

            if (i < accounts.length - 1) {
                const accountDelay = Math.floor(Math.random() * 10000) + 5000;
                logger.info(`Waiting ${Math.round(accountDelay / 1000)}s before next account...`, { context: 'System' });
                await delay(accountDelay, 0.1);
            }
        }

        let retries = 0;
        while (cycleFailedAccounts.length > 0 && retries < RETRY.cycleRetryCount) {
            logger.warn(`Cycle complete. ${cycleFailedAccounts.length} failed accounts. Retrying in 2 minutes...`, { context: 'Retry' });
            await delay(120000);

            retries++;
            logger.info(`Retry attempt ${retries}/${RETRY.cycleRetryCount}...`, { context: 'Retry' });

            const nextFailures = [];
            for (const idx of cycleFailedAccounts) {
                state.accounts[idx].status = 'RETRYING';
                renderTable();
                const success = await runAccountTasks(accounts[idx], idx);
                if (!success) {
                    nextFailures.push(idx);
                }
                await delay(5000);
            }
            cycleFailedAccounts = nextFailures;
        }

        if (cycleFailedAccounts.length > 0) {
            logger.error(`Giving up on ${cycleFailedAccounts.length} accounts after ${retries} retries.`, { context: 'System' });
        } else {
            logger.success('All accounts completed successfully!', { context: 'System' });
        }

        const nextReset = getNextResetTime();
        const waitMs = nextReset.getTime() - Date.now();

        for (let i = 0; i < state.accounts.length; i++) {
            if (state.accounts[i].status !== 'FAILED') {
                state.accounts[i].status = 'WAITING';
            }
            state.accounts[i].nextRun = nextReset.getTime();
        }

        logger.info(`Next run at: ${nextReset.toLocaleString()} (${formatDuration(waitMs)})`, { context: 'Schedule' });
        renderTable();

        const updateInterval = setInterval(() => { renderTable(); }, 60000);

        await new Promise(resolve => setTimeout(resolve, waitMs));
        clearInterval(updateInterval);

        for (let i = 0; i < state.accounts.length; i++) {
            state.accounts[i].status = 'WAITING';
            state.accounts[i].nextRun = null;
        }
        state.logs = [];
    }
}

process.on('uncaughtException', (err) => {
    fs.appendFileSync('error.log', `[${new Date().toISOString()}] UNCAUGHT: ${err.stack}\n`);
});
process.on('unhandledRejection', (err) => {
    fs.appendFileSync('error.log', `[${new Date().toISOString()}] UNHANDLED: ${err?.stack || err}\n`);
});

main().catch(error => {
    fs.appendFileSync('error.log', `[${new Date().toISOString()}] FATAL: ${error.stack}\n`);
    console.error(chalk.red('Fatal error:'), error.message);
    process.exit(1);
});
