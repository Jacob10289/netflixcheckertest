const express = require('express');
const cors = require('cors');
const path = require('path');
const NetflixAPI = require('./netflix');

const app = express();
const PORT = process.env.PORT || 3000;

const netflix = new NetflixAPI();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ==================== API ENDPOINTS ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Netflix Cookie Checker',
        timestamp: new Date().toISOString()
    });
});

// Check cookie - Basic
app.post('/api/check', async (req, res) => {
    try {
        const { cookie } = req.body;
        
        if (!cookie) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_COOKIE',
                message: 'Vui lòng cung cấp cookie'
            });
        }
        
        console.log('🔍 Checking cookie...');
        const result = await netflix.checkCookie(cookie);
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        console.error('Check error:', error);
        res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: error.message
        });
    }
});

// Get full account info
app.post('/api/info', async (req, res) => {
    try {
        const { cookie } = req.body;
        
        if (!cookie) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_COOKIE',
                message: 'Vui lòng cung cấp cookie'
            });
        }
        
        console.log('🔍 Getting account info...');
        const result = await netflix.getAccountInfo(cookie);
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        console.error('Info error:', error);
        res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: error.message
        });
    }
});

// Generate token & login link
app.post('/api/gen', async (req, res) => {
    try {
        const { cookie } = req.body;
        
        if (!cookie) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_COOKIE',
                message: 'Vui lòng cung cấp cookie'
            });
        }
        
        console.log('🔍 Checking cookie before generate token...');
        
        // Step 1: Check cookie
        const checkResult = await netflix.checkCookie(cookie);
        
        if (checkResult.status !== 'Live') {
            return res.status(400).json({
                success: false,
                error: 'INVALID_COOKIE',
                message: 'Cookie không hợp lệ hoặc đã hết hạn',
                checkResult
            });
        }
        
        // Step 2: Generate token
        console.log('✅ Cookie live, generating token...');
        const tokenResult = await netflix.generateToken(checkResult.cookies);
        
        res.json({
            success: true,
            status: 'Success',
            generationTime: new Date().toLocaleString('vi-VN'),
            expiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString('vi-VN'),
            timeRemaining: '24h',
            directLoginUrl: tokenResult.loginUrl,
            token: tokenResult.token,
            account: {
                country: checkResult.account.country,
                membershipStatus: checkResult.account.membershipStatus,
                profile: checkResult.profile?.name
            }
        });
        
    } catch (error) {
        console.error('Gen error:', error);
        res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: error.message
        });
    }
});

// Validate token (check xem token còn dùng được không)
app.post('/api/validate', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_TOKEN'
            });
        }
        
        // Decode token
        try {
            const payload = JSON.parse(Buffer.from(token, 'base64').toString());
            const isExpired = payload.expires < Date.now();
            
            res.json({
                success: true,
                valid: !isExpired,
                expiresAt: new Date(payload.expires).toISOString(),
                isExpired
            });
        } catch (e) {
            res.json({
                success: false,
                valid: false,
                message: 'Invalid token format'
            });
        }
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Netflix API Server running on port ${PORT}`);
    console.log(`📡 Endpoints:`);
    console.log(`   POST /api/check  - Check cookie status`);
    console.log(`   POST /api/info   - Get full account info`);
    console.log(`   POST /api/gen    - Generate login token`);
    console.log(`   POST /api/validate - Validate token`);
});
