const axios = require('axios');
const cheerio = require('cheerio');

class NetflixAPI {
    constructor() {
        this.baseURL = 'https://www.netflix.com';
        this.cookieJar = {};
    }

    // Parse cookie từ nhiều format
    parseCookie(cookieInput) {
        let cookies = {};
        
        try {
            // Format 1: JSON (EditThisCookie)
            if (cookieInput.trim().startsWith('[')) {
                const arr = JSON.parse(cookieInput);
                arr.forEach(c => {
                    if (c.name && c.value) cookies[c.name] = c.value;
                });
            }
            // Format 2: Netscape format
            else if (cookieInput.includes('\t')) {
                const lines = cookieInput.split('\n');
                lines.forEach(line => {
                    const parts = line.trim().split('\t');
                    if (parts.length >= 7) {
                        cookies[parts[5]] = parts[6];
                    }
                });
            }
            // Format 3: Header string
            else if (cookieInput.includes('=')) {
                cookieInput.split(';').forEach(pair => {
                    const [name, ...valueParts] = pair.trim().split('=');
                    if (name && valueParts.length > 0) {
                        cookies[name.trim()] = valueParts.join('=').trim();
                    }
                });
            }
        } catch (e) {
            console.error('Parse cookie error:', e.message);
        }
        
        // Kiểm tra cookie cần thiết
        if (!cookies['NetflixId'] && !cookies['netflixId']) {
            throw new Error('Missing NetflixId in cookie');
        }
        
        // Chuẩn hóa tên
        const normalized = {};
        Object.keys(cookies).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'netflixid') normalized['NetflixId'] = cookies[key];
            else if (lowerKey === 'securenetflixid') normalized['SecureNetflixId'] = cookies[key];
            else normalized[key] = cookies[key];
        });
        
        return normalized;
    }

    // Tạo cookie string
    stringifyCookies(cookies) {
        return Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    // Tạo headers giống browser thật
    getHeaders(cookieStr) {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cookie': cookieStr,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Connection': 'keep-alive',
        };
    }

    // Check cookie bằng cách vào trang browse
    async checkCookie(cookieInput) {
        try {
            const cookies = this.parseCookie(cookieInput);
            const cookieStr = this.stringifyCookies(cookies);
            
            console.log('Checking cookie:', Object.keys(cookies).join(', '));
            
            // Thử vào trang browse
            const response = await axios.get('https://www.netflix.com/browse', {
                headers: this.getHeaders(cookieStr),
                maxRedirects: 0,
                validateStatus: (status) => status < 400 || status === 302,
                timeout: 15000
            });

            // Nếu redirect về login → Cookie dead
            if (response.status === 302) {
                const location = response.headers.location || '';
                if (location.includes('login') || location.includes('signup')) {
                    return {
                        status: 'Dead',
                        message: 'Cookie hết hạn (redirect to login)',
                        redirect: location
                    };
                }
            }

            // Nếu vào được browse → Live
            if (response.status === 200) {
                // Parse thông tin từ HTML
                const $ = cheerio.load(response.data);
                const pageTitle = $('title').text();
                
                // Tìm data trong script tags
                let userData = {};
                $('script').each((i, elem) => {
                    const content = $(elem).html() || '';
                    if (content.includes('netflix') && content.includes('user')) {
                        try {
                            const match = content.match(/"userInfo":({[^}]+})/);
                            if (match) userData = JSON.parse(match[1]);
                        } catch (e) {}
                    }
                });

                return {
                    status: 'Live',
                    message: 'Cookie hợp lệ',
                    title: pageTitle,
                    cookies: cookies,
                    userData: userData
                };
            }

            return {
                status: 'Unknown',
                message: `Status code: ${response.status}`,
                headers: response.headers
            };

        } catch (error) {
            if (error.response?.status === 401 || error.response?.status === 403) {
                return {
                    status: 'Dead',
                    message: `Cookie không hợp lệ (${error.response.status})`
                };
            }
            
            console.error('Check error:', error.message);
            return {
                status: 'Error',
                message: error.message,
                details: error.code
            };
        }
    }

    // Generate token - Cách đơn giản hơn
    async generateToken(cookies) {
        try {
            const cookieStr = typeof cookies === 'string' ? cookies : this.stringifyCookies(cookies);
            
            // Cách 1: Tạo token từ cookie (base64)
            const tokenData = {
                NetflixId: cookies['NetflixId'],
                SecureNetflixId: cookies['SecureNetflixId'],
                timestamp: Date.now(),
                expires: Date.now() + (24 * 60 * 60 * 1000)
            };
            
            const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
            
            // Tạo login URL
            const encodedToken = encodeURIComponent(token);
            const loginUrl = `https://www.netflix.com/login?nftoken=${encodedToken}&nextpage=https%3A%2F%2Fwww.netflix.com%2Fbrowse`;
            
            return {
                success: true,
                token: token,
                loginUrl: loginUrl,
                expiresAt: new Date(tokenData.expires).toISOString(),
                method: 'cookie_based'
            };

        } catch (error) {
            console.error('Gen token error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Alternative: Dùng API khác để check
    async checkWithAlternative(cookieInput) {
        try {
            const cookies = this.parseCookie(cookieInput);
            
            // Thử gọi API whoami hoặc tương tự
            const response = await axios.get('https://www.netflix.com/api/shakti/v1b5c5e5f/profiles', {
                headers: {
                    'Cookie': this.stringifyCookies(cookies),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'X-Netflix.request.client.user.guid': cookies['NetflixId']?.split('%')[0] || '',
                },
                timeout: 10000,
                validateStatus: () => true // Accept all status
            });

            if (response.status === 200 && response.data) {
                return {
                    status: 'Live',
                    data: response.data,
                    cookies: cookies
                };
            }

            return {
                status: 'Dead',
                statusCode: response.status,
                message: 'API returned error'
            };

        } catch (error) {
            return {
                status: 'Error',
                message: error.message
            };
        }
    }
}

module.exports = NetflixAPI;
