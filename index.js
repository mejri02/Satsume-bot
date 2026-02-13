const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { ethers } = require('ethers');
const readline = require('readline');

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
    maxDelay: 30000
};

const SCHEDULE_RESET_HOUR_UTC = 0;
const LOG_LIMIT = 20;
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
    'Superb quality and fast delivery. Love it!'
];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

const OS_PLATFORMS = [
    { name: 'Windows', platform: '"Windows"', brands: '"Not A(Brand";v="99", "Google Chrome";v="122", "Chromium";v="122"' },
    { name: 'Macintosh', platform: '"macOS"', brands: '"Not A(Brand";v="99", "Google Chrome";v="122", "Chromium";v="122"' }
];

const WEBGL_VENDORS = ['Google Inc. (Intel)', 'Intel Inc.', 'NVIDIA Corporation', 'Apple Inc.'];
const WEBGL_RENDERERS = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    'Intel Iris OpenGL Engine',
    'Apple M1'
];

const LANGUAGES = [['en-US', 'en'], ['en-GB', 'en'], ['en-CA', 'en']];
const RESOLUTIONS = ['1920x1080', '2560x1440', '1366x768', '1440x900'];
const TIMEZONES = [-480, -420, -360, -300, -240, -180, -120, -60, 0, 60, 120, 180, 240, 300, 360, 420, 480];

const state = {
    accounts: [],
    logs: [],
    isRunning: true,
    useProxy: true
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
    if (state.logs.length > LOG_LIMIT) state.logs.shift();
}

const logger = {
    info: (msg, options = {}) => {
        const emoji = options.emoji || 'ℹ️';
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
        const emoji = options.emoji || '⚠️';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${chalk.yellow(msg)}`);
        renderTable();
    },
    error: (msg, options = {}) => {
        const emoji = options.emoji || '❌';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${chalk.red(msg)}`);
        renderTable();
    },
    status: (msg, options = {}) => {
        const emoji = options.emoji || '⏳';
        const context = options.context ? `[${options.context}]` : '';
        logToState(`${emoji} ${chalk.cyan(context.padEnd(14))} ${chalk.yellow(msg)}`);
        renderTable();
    }
};

function renderTable() {
    console.clear();

    console.log(chalk.hex('#FF6B6B').bold(`
    ╔══════════════════════════════════════════════════════════════════╗
    ║                                                                  ║
    ║     ███╗   ███╗███████╗     ██╗██████╗  ██████╗ ██████╗        ║
    ║     ████╗ ████║██╔════╝     ██║╚════██╗██╔═████╗╚════██╗       ║
    ║     ██╔████╔██║█████╗       ██║ █████╔╝██║██╔██║ █████╔╝       ║
    ║     ██║╚██╔╝██║██╔══╝  ██   ██║██╔═══╝ ████╔╝██║ ╚═══██╗       ║
    ║     ██║ ╚═╝ ██║███████╗╚█████╔╝███████╗╚██████╔╝██████╔╝       ║
    ║     ╚═╝     ╚═╝╚══════╝ ╚════╝ ╚══════╝ ╚═════╝ ╚═════╝        ║
    ║                                                                  ║
    ║                    🚀 SATSUME BOT V2.0 🚀                        ║
    ║                    ════════════════════════                      ║
    ║                       by mejri02                                 ║
    ║                                                                  ║
    ╚══════════════════════════════════════════════════════════════════╝
    `));

    console.log(chalk.hex('#4ECDC4')(`    🌐 PROXY MODE: ${state.useProxy ? chalk.green('ENABLED') : chalk.yellow('DISABLED')}`));
    console.log(chalk.hex('#FFE66D')(`    👥 ACCOUNTS: ${state.accounts.length} LOADED\n`));

    const table = new Table({
        head: [
            chalk.white('ID'), 
            chalk.white('IP'), 
            chalk.white('STATUS'), 
            chalk.white('CHECK'), 
            chalk.white('FAUCET'), 
            chalk.white('BUY'), 
            chalk.white('REVIEW')
        ],
        colWidths: [6, 18, 12, 10, 10, 15, 10],
        style: { head: ['bold'], border: ['grey'] }
    });

    state.accounts.forEach(acc => {
        let statusText = acc.status;
        let statusColor = chalk.blue;
        if (acc.status === 'SUCCESS') statusColor = chalk.green;
        else if (acc.status === 'FAILED') statusColor = chalk.red;
        else if (acc.status === 'PROCESSING') statusColor = chalk.yellow;
        else if (acc.status === 'WAITING') statusColor = chalk.hex('#A0A0A0');

        let purchaseDisplay = acc.purchase;
        if (acc.purchaseStatus && acc.purchase === '⏳') {
            purchaseDisplay = chalk.yellow(acc.purchaseStatus.substring(0, 12) + '...');
        }

        table.push([
            chalk.hex('#FF6B6B')(`#${acc.index}`),
            chalk.hex('#A8E6CF')(acc.ip || 'Direct'),
            statusColor(statusText),
            acc.checkin || '-',
            acc.faucet || '-',
            purchaseDisplay || '-',
            acc.review || '-'
        ]);
    });

    console.log(table.toString());

    console.log(chalk.hex('#FF9F1C')('\n ⚡ EXECUTION LOGS:'));
    console.log(chalk.hex('#2EC4B6')(' ─' + '─'.repeat(90)));
    state.logs.forEach(log => console.log(` ${log}`));
    console.log(chalk.hex('#2EC4B6')(' ─' + '─'.repeat(90)));
}

function updatePurchaseStatus(accState, message, step, productInfo = null) {
    const now = Date.now();
    if (!accState.lastPurchaseUpdate || now - accState.lastPurchaseUpdate > 1000) {
        accState.lastPurchaseUpdate = now;
        
        const steps = {
            'checking_balance': '💰 Balance',
            'checking_eth': '⛽ ETH',
            'fetching_products': '📦 Products',
            'finding_affordable': '🔍 Affordable',
            'trying_product': `🛒 ${productInfo?.name?.substring(0, 10) || 'Product'}`,
            'fetching_details': '📋 Details',
            'creating_order': '📝 Order',
            'getting_payment': '💳 Payment',
            'executing_tx': '⛓️ Tx',
            'waiting_confirmation': '⏳ Confirm',
            'success': '✅ Success',
            'failed': '❌ Failed',
            'skipped': '⏭️ Skip'
        };
        
        const displayStep = steps[step] || message;
        
        const dots = ['.', '..', '...'][Math.floor(now / 500) % 3];
        if (!step.includes('success') && !step.includes('failed') && !step.includes('skipped')) {
            accState.purchase = chalk.yellow(`⏳${dots}`);
            accState.purchaseStatus = displayStep;
        } else if (step.includes('success')) {
            accState.purchase = chalk.green('✓');
            accState.purchaseStatus = '';
        } else if (step.includes('failed')) {
            accState.purchase = chalk.red('✗');
            accState.purchaseStatus = '';
        } else if (step.includes('skipped')) {
            accState.purchase = chalk.yellow('SKIP');
            accState.purchaseStatus = '';
        }
        
        renderTable();
    }
}

function startCountdown(totalWaitMs, context = 'Schedule') {
    const startTime = Date.now();
    const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, totalWaitMs - elapsed);
        
        if (remaining <= 0) {
            clearInterval(interval);
            return;
        }
        
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        
        process.stdout.write(`\r${chalk.yellow('⏳')} ${chalk.cyan(`[${context}]`)} Next run in: ${chalk.white(`${h}h ${m}m ${s}s`)}`);
    }, 1000);
    return interval;
}

async function askUseProxy() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(chalk.yellow('▶ Do you want to use proxies? (y/n): '), (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

function loadPrivateKeys() {
    const accountsPath = path.join(__dirname, 'accounts.txt');
    if (!fs.existsSync(accountsPath)) {
        console.log(chalk.red('✗ accounts.txt not found!'));
        console.log(chalk.yellow('  Please create accounts.txt with one private key per line'));
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(accountsPath, 'utf8');
        const keys = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(pk => {
                if (!pk.startsWith('0x')) pk = '0x' + pk;
                return pk;
            })
            .filter(pk => pk.length === 66);

        if (keys.length === 0) {
            console.log(chalk.red('✗ No valid private keys found in accounts.txt'));
            process.exit(1);
        }
        return keys;
    } catch (e) {
        console.log(chalk.red('✗ Failed to parse accounts.txt:'), e.message);
        process.exit(1);
    }
}

function loadProxies() {
    const proxyPath = path.join(__dirname, 'proxy.txt');
    if (!fs.existsSync(proxyPath)) return [];
    try {
        const content = fs.readFileSync(proxyPath, 'utf8');
        return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    } catch (e) {
        return [];
    }
}

function loadFingerprints() {
    try {
        if (fs.existsSync(FINGERPRINT_FILE)) return JSON.parse(fs.readFileSync(FINGERPRINT_FILE, 'utf8'));
    } catch (e) { }
    return {};
}

function saveFingerprints(fingerprints) {
    fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(fingerprints, null, 2));
}

function generateFingerprint(walletAddress) {
    const seed = crypto.createHash('sha256').update(walletAddress.toLowerCase()).digest('hex');
    const uaIndex = parseInt(seed.substring(0, 8), 16) % USER_AGENTS.length;
    const userAgent = USER_AGENTS[uaIndex];
    
    let platform = 'Windows';
    if (userAgent.includes('Macintosh')) platform = 'Macintosh';
    
    const platformData = OS_PLATFORMS.find(p => p.name === platform) || OS_PLATFORMS[0];
    
    const canvasHash = crypto.createHash('sha256').update(seed + 'canvas').digest('hex').substring(0, 16);
    const webglVendor = WEBGL_VENDORS[parseInt(seed.substring(8, 16), 16) % WEBGL_VENDORS.length];
    const webglRenderer = WEBGL_RENDERERS[parseInt(seed.substring(16, 24), 16) % WEBGL_RENDERERS.length];
    
    const resIndex = parseInt(seed.substring(24, 32), 16) % RESOLUTIONS.length;
    const tzIndex = parseInt(seed.substring(32, 40), 16) % TIMEZONES.length;
    const langIndex = parseInt(seed.substring(40, 48), 16) % LANGUAGES.length;

    return {
        userAgent, platform,
        clientHints: {
            'sec-ch-ua': platformData.brands,
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': platformData.platform
        },
        canvasHash, webglVendor, webglRenderer,
        screenResolution: RESOLUTIONS[resIndex],
        timezoneOffset: TIMEZONES[tzIndex],
        language: LANGUAGES[langIndex][0],
        languages: LANGUAGES[langIndex],
        colorDepth: 24,
        hardwareConcurrency: [4, 8, 12, 16][parseInt(seed.substring(48, 56), 16) % 4],
        deviceMemory: [4, 8, 16, 32][parseInt(seed.substring(56, 64), 16) % 4],
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
        'accept-language': fingerprint.languages.join(', '),
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

class ApiClient {
    constructor(fingerprint, proxy = null) {
        this.fingerprint = fingerprint;
        this.accessToken = null;
        this.proxyAgent = createProxyAgent(proxy);
        this.proxyString = proxy || '';
    }

    setAccessToken(token) { this.accessToken = token; }
    getHeaders() { return buildHeaders(this.fingerprint, this.accessToken); }

    async request(method, endpoint, data = null, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        const maxRetries = options.maxRetries ?? RETRY.maxRetries;
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
                
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
                    reqConfig.proxy = false;
                }
                const response = await axios(reqConfig);
                return response.data;
            } catch (error) {
                lastError = error;
                const isRetryable = !error.response || error.response.status >= 500 || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
                if (isRetryable && attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, RETRY.baseDelay * Math.pow(2, attempt)));
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
        await client.get(ENDPOINTS.userInfo);
        await new Promise(resolve => setTimeout(resolve, DELAYS.minDelay));
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

async function fetchRecaptchaToken(proxy = null) {
    try {
        const co = Buffer.from(`${RECAPTCHA_SITE_URL}:443`).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const agentConfig = {};
        if (proxy) {
            const agent = createProxyAgent(proxy);
            if (agent) { agentConfig.httpsAgent = agent; agentConfig.httpAgent = agent; }
        }

        const anchorUrl = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&v=${Date.now()}&size=invisible&cb=${Date.now()}`;
        const anchorRes = await axios.get(anchorUrl, {
            headers: { 'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] },
            timeout: 15000,
            ...agentConfig
        });

        const tokenMatch = anchorRes.data.match(/recaptcha-token[^>]*value="([^"]+)"/);
        if (!tokenMatch) return null;
        const initialToken = tokenMatch[1];

        const reloadUrl = `https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITE_KEY}`;
        const reloadRes = await axios.post(reloadUrl,
            `v=${Date.now()}&reason=q&c=${encodeURIComponent(initialToken)}&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&size=invisible`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                    'Referer': `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITE_KEY}&co=${co}&hl=en&size=invisible`
                },
                timeout: 15000,
                ...agentConfig
            }
        );

        const rTokenMatch = reloadRes.data.match(/rresp","([^"]+)"/);
        if (rTokenMatch) return rTokenMatch[1];
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

    return { success: false, error: 'Failed to obtain nonce' };
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
        if (!nonceResult.success) return { success: false, error: nonceResult.error, address };
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
        return { success: false, error: loginResponse.message || 'Login failed', address };
    } catch (error) {
        const errMsg = error.response?.data?.message || error.response?.data?.reason || error.message;
        return { success: false, error: errMsg, address };
    }
}

async function getUserPoints(apiClient) {
    try {
        const response = await apiClient.get(ENDPOINTS.userInfo);
        if (response.code === 200 && response.data) return { success: true, points: response.data.points || 0 };
        return { success: false, error: response.message || 'Failed to fetch points' };
    } catch (error) { return { success: false, error: error.message }; }
}

async function performCheckin(apiClient) {
    try {
        const response = await apiClient.post(ENDPOINTS.checkin, {});
        if (response.code === 200) {
            return { success: true, pointsEarned: 0, message: 'Check-in successful' };
        }
        if (response.code === 400 || (response.message && response.message.toLowerCase().includes('already'))) {
            return { success: true, alreadyDone: true, pointsEarned: 0, message: 'Already checked in today' };
        }
        return { success: false, error: response.message || 'Check-in failed' };
    } catch (error) {
        const errMsg = error.response?.data?.message || error.message || '';
        if (errMsg.toLowerCase().includes('already')) return { success: true, alreadyDone: true, pointsEarned: 0, message: 'Already checked in today' };
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
        const contract = new ethers.Contract(NUSD_CONTRACT, NUSD_ABI, signer);

        const functions = ['dailyMint', 'claimDailyTokens', 'faucet', 'mint'];

        for (const funcName of functions) {
            try {
                if (contract[funcName]) {
                    await contract[funcName]();
                    return { success: true, message: 'Claimed NUSD' };
                }
            } catch (e) {
                const errMsg = e.reason || e.shortMessage || e.message || '';
                if (errMsg.toLowerCase().includes('already') || errMsg.toLowerCase().includes('minted today')) {
                    return { success: true, alreadyDone: true, message: 'Already claimed NUSD today' };
                }
                continue;
            }
        }
        return { success: false, error: 'Could not find faucet function' };
    } catch (error) {
        const errorMsg = error.message || '';
        if (errorMsg.includes('already claimed') || errorMsg.includes('once per day')) {
            return { success: true, alreadyDone: true, message: 'Already claimed NUSD today' };
        }
        if (errorMsg.includes('insufficient funds')) return { success: false, error: 'Insufficient gas' };
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
                price: parseInt(p.originalPrice) || 0
            }))
            .filter(p => p.price > 0);
        products.sort((a, b) => a.price - b.price);
        return { success: true, products };
    } catch (error) { return { success: false, error: error.message }; }
}

async function fetchProductDetail(apiClient, productId) {
    try {
        const response = await apiClient.get(`${ENDPOINTS.productDetail}/${productId}`);
        if (response.code !== 200 || !response.data) return { success: false, error: response.message || 'Product not found' };
        const skus = response.data.productSkus;
        if (!skus || skus.length === 0) return { success: false, error: 'No SKU available' };
        const validSku = skus.find(s => s.isEnabled !== false);
        if (!validSku) return { success: false, error: 'No valid SKU in stock' };
        return { success: true, skuId: validSku.id?.toString() || validSku.id, promotionId: response.data.promotionId || null };
    } catch (error) { return { success: false, error: error.message }; }
}

async function createOrder(apiClient, skuId, promotionId) {
    try {
        const payload = { skuId: skuId.toString(), quantity: 1, addressId: '', cartId: '' };
        if (promotionId) payload.promotionId = promotionId;
        const response = await apiClient.post(ENDPOINTS.createOrder, payload);
        if (response.code === 200 && response.data) return { success: true, orderId: response.data.toString() };
        return { success: false, error: response.message || response.reason || 'Failed to create order' };
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
        const namePromise = _nusdNameCache ? Promise.resolve(_nusdNameCache) : nusdContract.name().then(n => { _nusdNameCache = n; return n; });
        [nonce, domainName] = await Promise.all([nusdContract.nonces(owner), namePromise]);
    } catch (e) {
        nonce = await nusdContract.nonces(owner);
        domainName = NUSD_PERMIT_DOMAIN.name;
    }
    const domain = { ...NUSD_PERMIT_DOMAIN, name: domainName };
    const permitMessage = { owner, spender, value, nonce, deadline };
    const signature = await signer.signTypedData(domain, PERMIT_TYPES, permitMessage);
    const sig = ethers.Signature.from(signature);
    return { v: sig.v, r: sig.r, s: sig.s };
}

async function executePaymentOnChain(privateKey, paymentData) {
    try {
        const signer = createSigner(privateKey);
        const contractAddress = paymentData.address;
        const paymentContract = new ethers.Contract(contractAddress, PAYMENT_ABI, signer);

        let deadline = BigInt(paymentData.deadline);
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        const deadlineSec = deadline > 10000000000n ? deadline / 1000n : deadline;
        if (deadlineSec <= nowSec) return { success: false, error: 'Deadline expired' };

        const totalAmount = BigInt(paymentData.totalAmount);
        const permitSig = await signNusdPermit(signer, contractAddress, totalAmount, deadline);

        const callParams = [
            BigInt(paymentData.orderId), BigInt(paymentData.skuId), BigInt(paymentData.price),
            BigInt(paymentData.inventory), BigInt(paymentData.inventoryVersion), BigInt(paymentData.quantity),
            totalAmount, BigInt(paymentData.shippingFee), deadline, BigInt(paymentData.nonce),
            BigInt(paymentData.marketingRuleId || 0),
            paymentData.v, paymentData.r, paymentData.s,
            permitSig.v, permitSig.r, permitSig.s
        ];

        let gasLimit = 500000n;
        try {
            const estimated = await paymentContract.purchaseWithMarketingAndPermit.estimateGas(...callParams);
            gasLimit = estimated * 150n / 100n;
        } catch {}

        const tx = await paymentContract.purchaseWithMarketingAndPermit(...callParams, { gasLimit });
        const receipt = await tx.wait();
        if (receipt.status === 0) return { success: false, error: 'Transaction reverted' };
        return { success: true, txHash: receipt.hash };
    } catch (error) {
        const msg = error.shortMessage || error.reason || error.message || 'Unknown error';
        if (msg.includes('insufficient funds')) return { success: false, error: 'Insufficient ETH for gas' };
        return { success: false, error: msg };
    }
}

async function submitOrderTx(apiClient, orderId, txHash) {
    try {
        await apiClient.post(ENDPOINTS.submitOrder, { orderId: orderId.toString(), txHash });
        return { success: true };
    } catch (error) { return { success: true }; }
}

async function logPurchaseActivity(apiClient, userId) {
    try { await apiClient.post(ENDPOINTS.activityLog, { path: '/order/submit', userId: userId.toString() }); } catch (e) { }
}

async function performPurchase(apiClient, userId, privateKey, ctx, accState) {
    try {
        const wallet = new ethers.Wallet(privateKey);
        const address = wallet.address;
        
        updatePurchaseStatus(accState, null, 'checking_balance');
        const balanceNusd = await getNusdBalance(address);
        if (balanceNusd <= 0) {
            updatePurchaseStatus(accState, null, 'skipped');
            logger.warn('No NUSD balance - skipping purchase', { context: ctx });
            return { success: false, skipped: true };
        }

        updatePurchaseStatus(accState, null, 'checking_eth');
        try {
            const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
            const ethBal = await provider.getBalance(address);
            if (ethBal < ethers.parseEther('0.0005')) {
                updatePurchaseStatus(accState, null, 'skipped');
                logger.warn('Insufficient ETH for gas - skipping purchase', { context: ctx });
                return { success: false, skipped: true };
            }
        } catch (e) {}

        updatePurchaseStatus(accState, null, 'fetching_products');
        logger.status('Fetching product list...', { context: ctx });
        const listResult = await fetchProductList(apiClient);
        if (!listResult.success) {
            updatePurchaseStatus(accState, null, 'skipped');
            return { success: false, skipped: true };
        }

        const allProducts = listResult.products;
        if (allProducts.length === 0) {
            updatePurchaseStatus(accState, null, 'skipped');
            return { success: false, skipped: true };
        }

        updatePurchaseStatus(accState, null, 'finding_affordable');
        const affordable = allProducts.filter(p => p.price <= balanceNusd);
        if (affordable.length === 0) {
            updatePurchaseStatus(accState, null, 'skipped');
            return { success: false, skipped: true };
        }

        const shuffled = [...affordable].sort(() => Math.random() - 0.5);
        let lastError = '';

        for (let i = 0; i < Math.min(shuffled.length, 3); i++) {
            const product = shuffled[i];
            updatePurchaseStatus(accState, null, 'trying_product', product);
            logger.status(`Trying: ${product.name} (${product.price} NUSD)`, { context: ctx });

            try {
                updatePurchaseStatus(accState, null, 'fetching_details');
                const detailResult = await fetchProductDetail(apiClient, product.id);
                if (!detailResult.success) { 
                    lastError = detailResult.error; 
                    continue; 
                }

                updatePurchaseStatus(accState, null, 'creating_order');
                const orderResult = await createOrder(apiClient, detailResult.skuId, detailResult.promotionId);
                if (!orderResult.success) { 
                    lastError = orderResult.error; 
                    continue; 
                }

                updatePurchaseStatus(accState, null, 'getting_payment');
                const payResult = await getPaymentData(apiClient, orderResult.orderId);
                if (!payResult.success) {
                    lastError = payResult.error;
                    continue;
                }

                updatePurchaseStatus(accState, null, 'executing_tx');
                logger.status('Executing transaction...', { context: ctx });
                const onChainResult = await executePaymentOnChain(privateKey, payResult.paymentData);
                
                if (onChainResult.success) {
                    updatePurchaseStatus(accState, null, 'waiting_confirmation');
                    await submitOrderTx(apiClient, orderResult.orderId, onChainResult.txHash);
                    await logPurchaseActivity(apiClient, userId);
                    
                    updatePurchaseStatus(accState, null, 'success');
                    logger.success(`Purchase successful!`, { context: ctx });
                    return {
                        success: true,
                        orderId: orderResult.orderId,
                        product: product.name,
                        price: product.price
                    };
                } else {
                    lastError = onChainResult.error;
                }
            } catch (error) { 
                lastError = error.message; 
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        updatePurchaseStatus(accState, null, 'failed');
        return { success: false, error: lastError };
    } catch (error) { 
        updatePurchaseStatus(accState, null, 'failed');
        return { success: false, error: error.message }; 
    }
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
        return { success: true, orders: reviewable };
    } catch (error) { return { success: false, orders: [], error: error.message }; }
}

async function submitReview(apiClient, orderId, rating = 5) {
    try {
        const reviewContent = REVIEW_TEMPLATES[Math.floor(Math.random() * REVIEW_TEMPLATES.length)];
        const response = await apiClient.post(ENDPOINTS.submitReview, {
            orderId: orderId.toString(),
            rating: rating,
            content: reviewContent,
            isAnonymous: Math.random() > 0.3
        });
        if (response.code === 200) return { success: true };
        return { success: false, error: response.message || 'Failed to submit review' };
    } catch (error) { return { success: false, error: error.response?.data?.message || error.message }; }
}

async function logReviewActivity(apiClient, userId) {
    try { await apiClient.post(ENDPOINTS.activityLog, { path: '/order/list', userId: userId.toString() }); } catch (e) { }
}

async function performReview(apiClient, userId, orderId, ctx, accState) {
    try {
        let reviewedCount = 0;

        if (orderId) {
            logger.status(`Reviewing purchased order...`, { context: ctx });
            await new Promise(resolve => setTimeout(resolve, 2000));
            const result = await submitReview(apiClient, orderId, 5);
            if (result.success) {
                reviewedCount++;
                await logReviewActivity(apiClient, userId);
                logger.success(`Review submitted for purchased item`, { context: ctx });
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
        logger.status('Checking for unreviewed orders...', { context: ctx });
        const ordersResult = await getReviewableOrders(apiClient);

        if (!ordersResult.success) {
            if (reviewedCount > 0) {
                accState.review = chalk.green('✓');
                return { success: true };
            }
            accState.review = chalk.yellow('SKIP');
            return { success: true, skipped: true };
        }

        const pendingOrders = ordersResult.orders;

        if (pendingOrders.length === 0 && reviewedCount === 0) {
            logger.info('No orders pending review', { context: ctx });
            accState.review = chalk.yellow('SKIP');
            return { success: true, skipped: true };
        }

        for (const order of pendingOrders) {
            const oid = order.id?.toString() || order.id;
            if (orderId && oid === orderId.toString()) continue;

            logger.status(`Reviewing order...`, { context: ctx });
            await new Promise(resolve => setTimeout(resolve, 2000));
            const result = await submitReview(apiClient, oid, 5);
            if (result.success) {
                reviewedCount++;
                await logReviewActivity(apiClient, userId);
            }
        }

        if (reviewedCount > 0) {
            logger.success(`Submitted ${reviewedCount} review(s)`, { context: ctx });
            accState.review = chalk.green('✓');
            return { success: true };
        }
        
        accState.review = chalk.yellow('SKIP');
        return { success: true, skipped: true };
    } catch (error) { 
        accState.review = chalk.red('✗');
        return { success: false, error: error.message }; 
    }
}

async function getPublicIp(proxy) {
    try {
        const config = { 
            url: 'https://api.ipify.org?format=json', 
            timeout: 10000,
            headers: { 'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] }
        };
        if (proxy) {
            const agent = createProxyAgent(proxy);
            if (agent) { config.httpsAgent = agent; config.httpAgent = agent; config.proxy = false; }
        }
        const res = await axios(config);
        return res.data.ip || 'Unknown';
    } catch (e) { return 'Direct'; }
}

async function runAccountTasks(account, index, useProxy) {
    const ctx = `Account ${index + 1}`;
    const accState = state.accounts[index];

    accState.status = 'PROCESSING';
    accState.checkin = '-';
    accState.faucet = '-';
    accState.purchase = '-';
    accState.purchaseStatus = '';
    accState.review = '-';
    renderTable();

    let userId;

    try {
        const walletAddress = getWalletAddress(account.privateKey);
        logger.info(`Wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, { context: ctx });

        const fingerprint = getFingerprint(walletAddress);
        const proxyToUse = useProxy ? account.proxy : null;
        const apiClient = new ApiClient(fingerprint, proxyToUse);

        logger.status('Logging in...', { context: ctx });
        const loginResult = await login(apiClient, account.privateKey, proxyToUse);
        if (!loginResult.success) throw new Error(`Login failed: ${loginResult.error}`);
        logger.success(`Login successful`, { context: ctx });

        userId = loginResult.userId;
        logger.status('Warming up...', { context: ctx });
        await warmupRequests(apiClient);

        renderTable();
        await new Promise(resolve => setTimeout(resolve, DELAYS.taskDelay));

        logger.status('Checking in...', { context: ctx });
        const checkinResult = await performCheckin(apiClient);
        if (checkinResult.success) {
            if (checkinResult.alreadyDone) {
                accState.checkin = chalk.yellow('ALREADY');
                logger.warn('Already checked in today', { context: ctx });
            } else {
                accState.checkin = chalk.green('✓');
                logger.success(`Check-in successful`, { context: ctx });
            }
        } else {
            accState.checkin = chalk.red('✗');
        }
        renderTable();
        await new Promise(resolve => setTimeout(resolve, DELAYS.taskDelay));

        logger.status('Claiming NUSD faucet...', { context: ctx });
        const faucetResult = await performFaucetClaim(account.privateKey);
        if (faucetResult.success) {
            if (faucetResult.alreadyDone) {
                accState.faucet = chalk.yellow('ALREADY');
                logger.warn('Already claimed NUSD today', { context: ctx });
            } else {
                accState.faucet = chalk.green('✓');
                logger.success(`Faucet claimed`, { context: ctx });
            }
        } else {
            accState.faucet = chalk.red('✗');
        }
        renderTable();
        await new Promise(resolve => setTimeout(resolve, DELAYS.taskDelay));

        logger.status('Starting purchase...', { context: ctx });
        const purchaseResult = await performPurchase(apiClient, userId, account.privateKey, ctx, accState);
        
        renderTable();
        await new Promise(resolve => setTimeout(resolve, DELAYS.taskDelay));

        logger.status('Checking reviews...', { context: ctx });
        await performReview(apiClient, userId, purchaseResult.orderId, ctx, accState);

        accState.status = 'SUCCESS';
        accState.lastRun = Date.now();
        logger.success('All tasks completed!', { context: ctx });

    } catch (error) {
        accState.status = 'FAILED';
        accState.lastRun = Date.now();
        logger.error(`Error: ${error.message}`, { context: ctx });
    }

    renderTable();
}

function getNextResetTime() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCHEDULE_RESET_HOUR_UTC, 0, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
}

async function main() {
    console.clear();
    
    const useProxy = await askUseProxy();
    state.useProxy = useProxy;
    
    const privateKeys = loadPrivateKeys();
    const proxies = loadProxies();
    
    console.log(chalk.green(`\n✓ Loaded ${privateKeys.length} private keys`));
    if (useProxy) console.log(chalk.green(`✓ Loaded ${proxies.length} proxies`));
    console.log('');
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    const accounts = privateKeys.map((pk, index) => ({
        privateKey: pk,
        proxy: useProxy && proxies.length > 0 ? proxies[index % proxies.length] : null
    }));

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
            purchaseStatus: '',
            review: '-',
            lastPurchaseUpdate: 0
        });
    }

    renderTable();
    
    while (true) {
        for (let i = 0; i < accounts.length; i++) {
            state.accounts[i].status = 'PROCESSING';
            renderTable();

            await runAccountTasks(accounts[i], i, useProxy);

            if (i < accounts.length - 1) {
                const accountDelay = Math.floor(Math.random() * 10000) + 5000;
                logger.info(`Waiting ${Math.round(accountDelay/1000)}s before next account...`, { context: 'System' });
                await new Promise(resolve => setTimeout(resolve, accountDelay));
            }
        }

        const nextReset = getNextResetTime();
        const waitMs = nextReset.getTime() - Date.now();

        for (let i = 0; i < state.accounts.length; i++) {
            if (state.accounts[i].status !== 'FAILED') state.accounts[i].status = 'WAITING';
            state.accounts[i].nextRun = nextReset.getTime();
        }

        logger.info(`Next run at: ${nextReset.toLocaleString()} (${formatDuration(waitMs)})`, { context: 'Schedule' });
        renderTable();
        
        const countdownInterval = startCountdown(waitMs, 'Schedule');
        await new Promise(resolve => setTimeout(resolve, waitMs));
        clearInterval(countdownInterval);
        console.log('');

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
