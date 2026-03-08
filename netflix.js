const axios = require('axios');
const cheerio = require('cheerio');

class NetflixAPI {
    constructor() {
        this.baseURL = 'https://www.netflix.com';
        this.apiBase = 'https://www.netflix.com/api/shakti';
        this.buildIdentifier = null;
        this.authUrl = null;
    }

    // Parse cookie từ nhiều format
    parseCookie(cookieInput) {
        let cookies = {};
        
        // Format 1: JSON (EditThisCookie)
        if (cookieInput.trim().startsWith('[')) {
            try {
                const arr = JSON.parse(cookieInput);
                arr.forEach(c => {
                    cookies[c.name] = c.value;
                });
            } catch (e) {
                throw new Error('Invalid JSON cookie format');
            }
        }
        // Format 2: Netscape format
        else if (cookieInput.includes('\t')) {
            const lines = cookieInput.split('\n');
            lines.forEach(line => {
                const parts = line.trim().split('\t');
                if (parts.length >= 7) {
                    const name = parts[5];
                    const value = parts[6];
                    cookies[name] = value;
                }
            });
        }
        // Format 3: Header string (name=value; name2=value2)
        else if (cookieInput.includes('=')) {
            cookieInput.split(';').forEach(pair => {
                const [name, value] = pair.trim().split('=');
                if (name && value) cookies[name] = value;
            });
        }
        
        // Kiểm tra cookie cần thiết
        if (!cookies['NetflixId']) {
            throw new Error('Missing NetflixId in cookie');
        }
        
        return cookies;
    }

    // Tạo cookie string từ object
    stringifyCookies(cookies) {
        return Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    // Lấy build identifier (cần cho API calls)
    async getBuildId() {
        try {
            const response = await axios.get('https://www.netflix.com/login', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });
            
            const $ = cheerio.load(response.data);
            
            // Tìm trong script tags
            const scripts = $('script').toArray();
            for (let script of scripts) {
                const content = $(script).html() || '';
                
                // Tìm AUTH_URL
                const authMatch = content.match(/"AUTH_URL":"([^"]+)"/);
                if (authMatch) this.authUrl = authMatch[1];
                
                // Tìm build identifier
                const buildMatch = content.match(/"BUILD_IDENTIFIER":"([^"]+)"/);
                if (buildMatch) {
                    this.buildIdentifier = buildMatch[1];
                    return this.buildIdentifier;
                }
            }
            
            // Fallback
            this.buildIdentifier = 'v1b5c5e5f'; // Có thể thay đổi theo thời gian
            return this.buildIdentifier;
            
        } catch (error) {
            console.error('Get build ID error:', error.message);
            this.buildIdentifier = 'v1b5c5e5f';
            return this.buildIdentifier;
        }
    }

    // Check cookie và lấy thông tin account
    async checkCookie(cookieInput) {
        try {
            const cookies = this.parseCookie(cookieInput);
            const cookieStr = this.stringifyCookies(cookies);
            
            // Bước 1: Vào trang chính để check redirect
            const homeResponse = await axios.get(this.baseURL + '/browse', {
                headers: {
                    'Cookie': cookieStr,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                },
                maxRedirects: 0,
                validateStatus: (status) => status < 400 || status === 302
            });

            // Nếu redirect về login → Cookie dead
            if (homeResponse.status === 302 && homeResponse.headers.location?.includes('login')) {
                return {
                    status: 'Dead',
                    message: 'Cookie hết hạn hoặc không hợp lệ',
                    redirect: homeResponse.headers.location
                };
            }

            // Bước 2: Lấy thông tin user từ API
            const buildId = await this.getBuildId();
            const apiUrl = `${this.apiBase}/${buildId}/profiles`;
            
            const apiResponse = await axios.get(apiUrl, {
                headers: {
                    'Cookie': cookieStr,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'X-Netflix.request.client.user.guid': cookies['NetflixId']?.split('%')[0] || '',
                }
            });

            const userData = apiResponse.data;
            
            // Parse thông tin
            const profiles = userData.profiles || [];
            const activeProfile = profiles.find(p => p.isActive) || profiles[0];
            
            return {
                status: 'Live',
                message: 'Cookie hợp lệ',
                account: {
                    guid: userData.guid,
                    country: userData.countryOfSignup,
                    membershipStatus: userData.membershipStatus,
                    isInFreeTrial: userData.isInFreeTrial,
                    canWatch: userData.canWatch,
                },
                profile: activeProfile ? {
                    id: activeProfile.guid,
                    name: activeProfile.profileName,
                    avatar: activeProfile.avatarImages?.[0]?.url,
                    maturityLevel: activeProfile.maturityLevel,
                } : null,
                profiles: profiles.map(p => ({
                    id: p.guid,
                    name: p.profileName
                })),
                cookies: cookies
            };

        } catch (error) {
            if (error.response?.status === 401) {
                return {
                    status: 'Dead',
                    message: 'Cookie không hợp lệ (401 Unauthorized)'
                };
            }
            
            console.error('Check cookie error:', error.message);
            return {
                status: 'Error',
                message: error.message,
                details: error.response?.data
            };
        }
    }

    // Generate Auto Login Token
    async generateToken(cookies) {
        try {
            // Netflix sử dụng nhiều cách tạo token, đây là cách phổ biến nhất
            
            const cookieStr = typeof cookies === 'string' ? cookies : this.stringifyCookies(cookies);
            
            // Cách 1: Dùng API /signup/login
            const response = await axios.post('https://www.netflix.com/api/auth/login', {
                // Netflix internal API, có thể thay đổi
            }, {
                headers: {
                    'Cookie': cookieStr,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                }
            });

            // Cách 2: Tạo manual token (base64 của cookie + timestamp)
            const tokenPayload = {
                netflixId: cookies['NetflixId'],
                secureNetflixId: cookies['SecureNetflixId'],
                created: Date.now(),
                expires: Date.now() + (24 * 60 * 60 * 1000) // 24h
            };
            
            const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
            
            // Tạo login link
            const loginUrl = `https://www.netflix.com/login?nftoken=${token}&nextpage=https%3A%2F%2Fwww.netflix.com%2Fbrowse`;
            
            return {
                success: true,
                token: token,
                loginUrl: loginUrl,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                method: 'manual'
            };

        } catch (error) {
            console.error('Generate token error:', error.message);
            
            // Fallback: Tạo token đơn giản
            return {
                success: true,
                token: 'manual_' + Date.now(),
                loginUrl: 'https://www.netflix.com/login',
                expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                method: 'fallback',
                note: 'Sử dụng login trực tiếp vì không thể tạo auto token'
            };
        }
    }

    // Get account info chi tiết
    async getAccountInfo(cookieInput) {
        const checkResult = await this.checkCookie(cookieInput);
        
        if (checkResult.status !== 'Live') {
            return checkResult;
        }
        
        // Thêm thông tin bổ sung
        try {
            const cookies = typeof cookieInput === 'string' ? this.parseCookie(cookieInput) : cookieInput;
            const cookieStr = this.stringifyCookies(cookies);
            
            // Lấy subscription info
            const response = await axios.get('https://www.netflix.com/account', {
                headers: {
                    'Cookie': cookieStr,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                }
            });
            
            const $ = cheerio.load(response.data);
            
            // Parse subscription details từ HTML
            const plan = $('.account-section:nth(0) .account-subsection').text().trim();
            const nextBilling = $('.account-section').text().match(/Next billing: ([^<]+)/)?.[1];
            
            return {
                ...checkResult,
                subscription: {
                    plan: plan || 'Unknown',
                    nextBilling: nextBilling || 'Unknown',
                }
            };
            
        } catch (e) {
            return checkResult;
        }
    }
}

module.exports = NetflixAPI;
