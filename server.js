 // Thêm endpoint test để debug
app.post('/api/debug', async (req, res) => {
    try {
        const { cookie } = req.body;
        
        if (!cookie) {
            return res.status(400).json({ error: 'Missing cookie' });
        }
        
        // Parse cookie để xem
        let parsed;
        try {
            parsed = netflix.parseCookie(cookie);
        } catch (e) {
            parsed = { error: e.message };
        }
        
        res.json({
            receivedLength: cookie.length,
            receivedPreview: cookie.substring(0, 100) + '...',
            parsedKeys: Object.keys(parsed),
            parsed: parsed
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sửa endpoint /api/gen để thử nhiều cách
app.post('/api/gen', async (req, res) => {
    try {
        const { cookie } = req.body;
        
        if (!cookie) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_COOKIE'
            });
        }
        
        console.log('🔍 Trying method 1: Standard check...');
        let checkResult = await netflix.checkCookie(cookie);
        
        // Nếu method 1 fail, thử method 2
        if (checkResult.status !== 'Live') {
            console.log('🔍 Trying method 2: Alternative API...');
            checkResult = await netflix.checkWithAlternative(cookie);
        }
        
        if (checkResult.status !== 'Live') {
            return res.status(400).json({
                success: false,
                error: 'INVALID_COOKIE',
                message: checkResult.message,
                details: checkResult
            });
        }
        
        console.log('✅ Cookie live, generating token...');
        const tokenResult = await netflix.generateToken(checkResult.cookies);
        
        res.json({
            success: true,
            status: 'Success',
            generationTime: new Date().toLocaleString('vi-VN'),
            ...tokenResult,
            checkMethod: checkResult.status === 'Live' ? 'standard' : 'alternative'
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
