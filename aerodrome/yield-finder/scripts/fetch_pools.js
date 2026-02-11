import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

// Configuration
const SUGAR_ADDRESS = '0x68c19e13618C41158fE4bAba1B8fb3A9c74bDb0A';
const AERO_TOKEN_ADDRESS = '0x940181a94a35A4569E4529A3CDfB74e38FD98631'; // AERO on Base
const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'; // cbBTC on Base
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // WETH on Base
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';



// ABI for Sugar.all
const SUGAR_ABI = parseAbi([
    'struct Lp { address lp; string symbol; uint8 decimals; uint256 liquidity; int24 type; int24 tick; uint160 sqrt_ratio; address token0; uint256 reserve0; uint256 staked0; address token1; uint256 reserve1; uint256 staked1; address gauge; uint256 gauge_liquidity; bool gauge_alive; address fee; address bribe; address factory; uint256 emissions; address emissions_token; uint256 emissions_cap; }',
    'function all(uint256 limit, uint256 offset) view returns (Lp[])'
]);

// Helper to fetch prices
async function fetchPrices() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=aerodrome-finance,ethereum,wrapped-bitcoin&vs_currencies=usd');
        if (!response.ok) throw new Error('Failed to fetch prices');
        const data = await response.json();
        return {
            aero: data['aerodrome-finance']?.usd || 1.50,
            eth: data['ethereum']?.usd || 3300,
            btc: data['wrapped-bitcoin']?.usd || 95000
        };
    } catch (error) {
        console.warn('Warning: Could not fetch prices from CoinGecko. Using defaults.');
        return { aero: 1.50, eth: 3300, btc: 95000 };
    }
}



// Helper to parse arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        minTvl: 10000,
        limit: 10,
        offset: 0
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--min-tvl') options.minTvl = parseFloat(args[i + 1]);
        if (args[i] === '--limit') options.limit = parseInt(args[i + 1]);
        if (args[i] === '--offset') options.offset = parseInt(args[i + 1]);
    }
    return options;
}

async function main() {
    const options = parseArgs();
    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    try {
        console.error('Fetching token prices...');
        const prices = await fetchPrices();
        console.error(`Prices: AERO=$${prices.aero}, ETH=$${prices.eth}, BTC=$${prices.btc}`);

        console.error(`Connecting to Base via ${RPC_URL}...`);

        // Fetch pools from Sugar contract
        const fetchLimit = 300; // Fetch more to filter down
        const pools = await client.readContract({
            address: SUGAR_ADDRESS,
            abi: SUGAR_ABI,
            functionName: 'all',
            args: [BigInt(fetchLimit), BigInt(options.offset)]
        });

        console.error(`Fetched ${pools.length} pools. Processing...`);

        // Filter out pools with dead gauges
        const activePools = pools.filter(pool => pool.gauge_alive);
        console.error(`Active pools: ${activePools.length}`);

        const processedPools = activePools.map(pool => {
            let tvlUSD = 0;

            const t0 = pool.token0.toLowerCase();
            const t1 = pool.token1.toLowerCase();

            // Helper to get partial USD value
            const getVal = (addr, amount) => {
                // USDC - 6 decimals
                if (addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
                    return Number(amount) / 1e6;
                // USDbC - 6 decimals  
                if (addr === '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca')
                    return Number(amount) / 1e6;
                // DAI - 18 decimals
                if (addr === '0x50c5725949a6f0c72e6c4a641f24049a917db0cb')
                    return Number(amount) / 1e18;
                // WETH - 18 decimals
                if (addr === WETH_ADDRESS.toLowerCase())
                    return Number(amount) / 1e18 * prices.eth;
                // AERO - 18 decimals
                if (addr === AERO_TOKEN_ADDRESS.toLowerCase())
                    return Number(amount) / 1e18 * prices.aero;
                // cbBTC - 8 decimals
                if (addr === CBBTC_ADDRESS.toLowerCase())
                    return Number(amount) / 1e8 * prices.btc;

                return 0; // Unknown token
            };

            // If we know price of one token, we can double it for TVL (roughly 50/50 in V2/active V3)
            let val0 = getVal(t0, pool.reserve0);
            let val1 = getVal(t1, pool.reserve1);

            if (val0 > 0 && val1 > 0) tvlUSD = val0 + val1;
            else if (val0 > 0) tvlUSD = val0 * 2;
            else if (val1 > 0) tvlUSD = val1 * 2;
            else tvlUSD = 0; // Unknown tokens

            // Emissions are in AERO per second (18 decimals)
            const emissionsPerYear = Number(pool.emissions) / 1e18 * 31536000;
            const annualRewardUSD = emissionsPerYear * prices.aero;

            let apr = 0;
            if (tvlUSD > 0) {
                apr = (annualRewardUSD / tvlUSD) * 100;
            }

            return {
                symbol: pool.symbol,
                address: pool.lp,
                tvl: tvlUSD,
                apr: apr,
                emissionsPerYear: emissionsPerYear,
                type: Number(pool.type) === 0 ? 'Volatile' : (Number(pool.type) === 1 ? 'Stable' : 'Concentrated')
            };
        });

        // Filter and Sort
        const filtered = processedPools
            .filter(p => p.tvl >= options.minTvl)
            .sort((a, b) => b.apr - a.apr)
            .slice(0, options.limit);

        // Output JSON
        console.log(JSON.stringify(filtered, null, 2));

    } catch (error) {
        console.error('Error fetching pools:', error);
        process.exit(1);
    }
}

main();
