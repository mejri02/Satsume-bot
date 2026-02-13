# 🚀 Satsume Bot V2.0

[![GitHub](https://img.shields.io/badge/GitHub-mejri02-blue?logo=github)](https://github.com/mejri02)
[![Node.js](https://img.shields.io/badge/Node.js-v16+-green?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **🎁 Join Satsume**: [https://satsume.com?inviteCode=MLJB5PPX](https://satsume.com?inviteCode=MLJB5PPX)

Automated bot for [Satsume](https://satsume.com?inviteCode=MLJB5PPX) platform tasks including daily check-ins, NUSD faucet claims, automated purchases, and order reviews.

## Features

- **Multi-Account Support** - Manage unlimited accounts simultaneously
- **Proxy Support** - Optional proxy rotation for each account
- **Daily Check-ins** - Automated daily check-in for points
- **NUSD Faucet Claims** - Auto-claim daily NUSD tokens on Sepolia testnet
- **Smart Purchasing** - Automated product purchases with balance-aware selection
- **Auto Reviews** - Submit reviews for purchased items
- **Scheduled Execution** - Runs daily at UTC midnight automatically
- **Beautiful CLI Interface** - Real-time status dashboard with detailed logging
- **Persistent Sessions** - Token caching to minimize login requests
- **Device Fingerprinting** - Consistent browser fingerprints per wallet

## Prerequisites

- [Node.js](https://nodejs.org/) v16 or higher
- npm or yarn package manager
- Private keys for Ethereum wallets (Sepolia testnet)
- (Optional) Proxy list for enhanced privacy

## Installation

1. **Clone the repository**
```bash
git clone https://github.com/mejri02/Satsume-bot.git
cd Satsume-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure accounts**

Create an `accounts.txt` file in the root directory with one private key per line:
```
private_key_1
private_key_2
private_key_3
```

> **Security Warning**: Never share your private keys or commit `accounts.txt` to version control!

4. **(Optional) Configure proxies**

Create a `proxy.txt` file with one proxy per line:
```
http://username:password@host:port
socks5://username:password@host:port
http://host:port
```

Supported formats:
- HTTP/HTTPS proxies
- SOCKS5 proxies

## Usage

Start the bot:
```bash
node index.js
```

On startup, you'll be prompted:
```
▶ Do you want to use proxies? (y/n):
```

- Enter `y` to enable proxy rotation
- Enter `n` to run with direct connections

The bot will then:
1. Load all accounts from `accounts.txt`
2. Display a real-time dashboard
3. Execute tasks for each account sequentially
4. Wait until next UTC midnight and repeat

## Dashboard Overview

```
╔══════════════════════════════════════════════════════════════════╗
║                    🚀 SATSUME BOT V2.0 🚀                        ║
║                    ════════════════════════                      ║
║                       by mejri02                                 ║
╚══════════════════════════════════════════════════════════════════╝

🌐 PROXY MODE: ENABLED
👥 ACCOUNTS: 5 LOADED

┌────┬─────────────────┬───────────┬─────────┬─────────┬──────────────┬─────────┐
│ ID │ IP              │ STATUS    │ CHECK   │ FAUCET  │ BUY          │ REVIEW  │
├────┼─────────────────┼───────────┼─────────┼─────────┼──────────────┼─────────┤
│ #1 │ 123.45.67.89    │ SUCCESS   │ ✓       │ ✓       │ ✓            │ ✓       │
│ #2 │ 98.76.54.32     │ PROCESSING│ ✓       │ ALREADY │ ⏳...        │ -       │
│ #3 │ Direct          │ WAITING   │ -       │ -       │ -            │ -       │
└────┴─────────────────┴───────────┴─────────┴─────────┴──────────────┴─────────┘
```

### Status Indicators

| Icon | Meaning |
|------|---------|
| ✓ | Task completed successfully |
| ✗ | Task failed |
| ⏳ | Task in progress |
| ALREADY | Already completed today |
| SKIP | Task skipped (e.g., insufficient balance) |
| - | Not started yet |

## Task Flow

For each account, the bot performs:

1. **Login** - Authenticates with wallet signature
2. **Warmup** - Initializes session with API requests
3. **Check-in** - Daily point collection
4. **Faucet Claim** - Claims NUSD tokens on Sepolia
5. **Purchase** - Buys affordable products automatically
6. **Review** - Submits reviews for purchased items

## Advanced Configuration

### Timing Settings

Edit these constants in `index.js`:

```javascript
const DELAYS = {
    minDelay: 2000,      // Min delay between requests (ms)
    maxDelay: 5000,      // Max delay between requests (ms)
    taskDelay: 8000,     // Delay between tasks (ms)
    microPause: 500      // Small pauses (ms)
};

const SCHEDULE_RESET_HOUR_UTC = 0;  // Daily reset hour (UTC)
```

### Retry Configuration

```javascript
const RETRY = {
    maxRetries: 3,       // Max API retry attempts
    baseDelay: 1000,     // Initial retry delay (ms)
    maxDelay: 30000      // Max retry delay (ms)
};
```

## Generated Files

The bot creates these files automatically:

- `tokens.json` - Cached authentication tokens
- `device_fingerprints.json` - Browser fingerprints per wallet
- `error.log` - Error logs for debugging

> Note: These files can be deleted to reset the bot state

## Security Best Practices

1. **Never share private keys** - Keep `accounts.txt` private
2. **Use testnet only** - This bot is designed for Sepolia testnet
3. **Secure your proxies** - Use authenticated proxies when possible
4. **Review the code** - Always audit code that handles private keys
5. **Monitor activity** - Check the dashboard regularly for anomalies

## Troubleshooting

### "No valid private keys found"
- Ensure `accounts.txt` exists in the root directory
- Check that keys are 64-character hex strings (with or without `0x` prefix)
- Verify one key per line with no extra spaces

### "Login failed: Failed to obtain nonce"
- Check your internet connection
- Verify the wallet address is valid
- Try disabling proxies temporarily

### "Insufficient ETH for gas"
- Get Sepolia ETH from a faucet: [Sepolia Faucet](https://sepoliafaucet.com/)
- Ensure wallet has at least 0.0005 ETH for gas

### "Transaction reverted"
- Check NUSD balance
- Verify product is still in stock
- Ensure payment contract address is correct

## Support & Community

- **GitHub**: [mejri02](https://github.com/mejri02)
- **Invite Link**: [Join Satsume](https://satsume.com?inviteCode=MLJB5PPX)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Disclaimer

This bot is for educational purposes only. Use at your own risk. The author is not responsible for:

- Lost funds or assets
- Account bans or restrictions
- Any damages resulting from using this software

Always ensure you comply with the platform's Terms of Service.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [ethers.js](https://docs.ethers.org/)
- CLI powered by [chalk](https://github.com/chalk/chalk) and [cli-table3](https://github.com/cli-table/cli-table3)
- HTTP requests via [axios](https://axios-http.com/)

---

**If you find this bot useful, please star the repository!**

Made with love by [mejri02](https://github.com/mejri02)
