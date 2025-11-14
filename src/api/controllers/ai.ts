'use strict';

// ===== Vertex AI (via GoogleAuth) =====
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID =
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    '';
const REGION = (process.env.VERTEX_REGION || 'us-central1').trim();

// Ưu tiên model, có thể chỉnh trong .env
const MODEL_PRIORITY = (
    process.env.VERTEX_GEMINI_PRIORITY ||
    'gemini-2.5-flash,gemini-1.5-flash,gemini-1.0-pro'
)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

if (!PROJECT_ID) {
    console.warn('[Vertex Chat] Missing GOOGLE_CLOUD_PROJECT_ID env');
}
if (!REGION) {
    console.warn('[Vertex Chat] Missing VERTEX_REGION env');
}

// ===== Simple in-memory rate limit: 50 req / user / 24h =====
const MAX_REQUESTS_PER_USER = 50;
const WINDOW_MS = 24 * 60 * 60 * 1000;

type Bucket = {
    count: number;
    resetAt: number;
};

const requestBuckets: Map<string, Bucket> = new Map();

const getUserKey = (user: any, ctx: any): string => {
    const primary = user?.primary || {};
    const name = primary.name || user?.name || 'unknown';
    const dob = primary.dob || user?.dob || '';
    const ip =
        (ctx?.request &&
            (ctx.request.ip || ctx.request.headers['x-forwarded-for'])) ||
        ctx?.ip ||
        '';
    // Key đơn giản đủ dùng cho demo
    return `${name}|${dob}|${ip}`;
};

const checkRateLimit = (user: any, ctx: any) => {
    const key = getUserKey(user, ctx);
    const now = Date.now();

    let bucket = requestBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        bucket = {
            count: 0,
            resetAt: now + WINDOW_MS,
        };
    }

    if (bucket.count >= MAX_REQUESTS_PER_USER) {
        requestBuckets.set(key, bucket);
        return {
            allowed: false,
            remaining: 0,
            resetAt: bucket.resetAt,
        };
    }

    bucket.count += 1;
    requestBuckets.set(key, bucket);

    return {
        allowed: true,
        remaining: MAX_REQUESTS_PER_USER - bucket.count,
        resetAt: bucket.resetAt,
    };
};

// ===== Lấy access token từ service account (GOOGLE_APPLICATION_CREDENTIALS) =====
const getAccessToken = async () => {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token || !token.token) {
        throw new Error('Cannot obtain OAuth access token for Vertex');
    }
    return token.token;
};

// ===== Prompt phong thủy (viết rõ ràng, thân thiện, tiếng Việt) =====
const getFengShuiPrompt = (user: any): string => {
    let prompt = '';

    // Giới thiệu & vai trò
    prompt +=
        'Bạn là **Kim Hạnh II AI** – trợ lý phong thủy & trang sức vàng của tiệm vàng Kim Hạnh II.\n';
    prompt +=
        'Nhiệm vụ của bạn là tư vấn NGẮN GỌN, DỄ HIỂU, THÂN THIỆN nhưng vẫn CHUYÊN NGHIỆP cho khách hàng.\n';
    prompt +=
        'Luôn xưng là "em" và gọi khách là "anh" hoặc "chị" (tùy ngữ cảnh câu chữ cho tự nhiên).\n\n';

    prompt +=
        'Hãy dựa trên thông tin dưới đây để phân tích mệnh, ngũ hành và gợi ý trang sức vàng phù hợp.\n\n';

    // Thông tin khách hàng
    prompt += '**Thông tin khách hàng:**\n';
    prompt += `- Họ và tên: ${user?.primary?.name || 'Không rõ'}\n`;
    prompt += `- Ngày tháng năm sinh (dương lịch): ${
        user?.primary?.dob || 'Không rõ'
    }\n`;

    if (user?.purchaseType === 'wedding' && user?.partner) {
        prompt += '\n**Thông tin người phối ngẫu (vợ/chồng):**\n';
        prompt += `- Họ và tên: ${user.partner.name || 'Không rõ'}\n`;
        prompt += `- Ngày tháng năm sinh (dương lịch): ${
            user.partner.dob || 'Không rõ'
        }\n\n`;
        prompt +=
            'Đây là trang sức cưới. Hãy ưu tiên tư vấn sao cho hai vợ chồng HÒA HỢP, hỗ trợ nhau về tài lộc và hạnh phúc gia đình.\n';
    } else {
        prompt += '\nĐây là khách đang mua trang sức cho chính bản thân.\n';
    }

    // Cách trình bày câu trả lời
    prompt += '\n---\n\n';
    prompt += '🎯 **CÁCH TRẢ LỜI CHO KHÁCH:**\n';
    prompt +=
        'Hãy trả lời theo 3–5 mục rõ ràng, dùng tiêu đề in đậm theo dạng Markdown:\n';
    prompt +=
        '1. **Mở đầu & mệnh tổng quan** – Chào khách (anh/chị), tóm tắt mệnh/ngũ hành và vài tính cách nổi bật (2–3 câu).\n';
    prompt +=
        '2. **Màu sắc & loại vàng hợp mệnh** – Nêu rõ nên ưu tiên loại vàng/màu nào (vàng 24K, 18K, 14K…), màu nào nên hạn chế để tránh xung khắc.\n';
    prompt +=
        '3. **Gợi ý kiểu trang sức** – Tập trung gợi ý vòng tay, lắc, nhẫn, bông tai… kiểu trơn, đính đá, chạm khắc… sao cho:\n';
    prompt +=
        '   - Hợp mệnh, hỗ trợ tài lộc, bình an.\n';
    prompt +=
        '   - Dễ đeo hằng ngày hoặc phù hợp dịp cưới hỏi (nếu là trang sức cưới).\n';
    prompt +=
        '4. **Lời khuyên thêm từ Kim Hạnh II** – 1–2 ý nhỏ về cách phối trang sức, giữ gìn may mắn, cách chọn số lượng món cho cân đối.\n\n';

    // Quy định bắt buộc
    prompt += '**QUY ĐỊNH BẮT BUỘC:**\n';
    prompt += '- Chỉ trả lời bằng **tiếng Việt**.\n';
    prompt +=
        '- Không nhắc lại yêu cầu của hệ thống, không liệt kê dàn ý, hãy viết thẳng bài tư vấn hoàn chỉnh.\n';
    prompt +=
        '- Giọng văn thân thiện, gần gũi nhưng không quá suồng sã; không dùng từ ngữ thô tục.\n';
    prompt +=
        '- Không cần xin lỗi trừ khi thực sự không thể trả lời được.\n';

    return prompt;
};

// ===== Convert body FE -> Vertex contents =====
const buildContentsForVertex = (
    user: any,
    history: any[] = [],
    newMessage?: string
) => {
    // Nếu có hội thoại trước đó + câu hỏi mới: tiếp tục cuộc trò chuyện
    if (newMessage && history.length > 0) {
        const contents = history.map((msg: any) => ({
            // FE đang dùng role: 'user' | 'model'
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.content || '' }],
        }));

        contents.push({
            role: 'user',
            parts: [{ text: newMessage }],
        });

        return contents;
    }

    // Lần đầu: chỉ gửi prompt tư vấn ban đầu dựa trên thông tin khách
    const prompt = getFengShuiPrompt(user);
    return [
        {
            role: 'user',
            parts: [{ text: prompt }],
        },
    ];
};

// ===== Gọi Vertex với fallback qua danh sách MODEL_PRIORITY =====
const generateWithVertex = async (contents: any[]) => {
    if (!PROJECT_ID) {
        throw new Error('Vertex not configured: missing projectId');
    }

    const models = MODEL_PRIORITY.length
        ? MODEL_PRIORITY
        : ['gemini-2.5-flash', 'gemini-1.5-flash'];

    let lastError: any = null;

    for (const modelName of models) {
        const fullModel = `projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${modelName}`;
        const url = `https://${REGION}-aiplatform.googleapis.com/v1/${fullModel}:generateContent`;

        try {
            const token = await getAccessToken();

            const body: any = {
                contents,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048,
                },
            };

            console.log(`[Vertex Chat] Calling model: ${modelName} ...`);
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const text = await res.text();
                console.error(
                    `[Vertex Chat] HTTP ${res.status} from ${modelName}:`,
                    text
                );

                if ([429, 500, 503].includes(res.status)) {
                    lastError = new Error(
                        `Vertex overloaded (${res.status}) for ${modelName}: ${text}`
                    );
                    continue;
                }

                throw new Error(
                    `Vertex error ${res.status} for ${modelName}: ${text}`
                );
            }

            const data: any = await res.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const text = parts.map((p: any) => p?.text || '').join('').trim();

            if (text) {
                console.log(`[Vertex Chat] Success with model: ${modelName}`);
                return text;
            }

            console.warn(
                `[Vertex Chat] Empty response from ${modelName}, trying next...`
            );
            lastError = new Error(`Empty response from ${modelName}`);
        } catch (err: any) {
            const msg = String(err?.message || '');
            console.error(`[Vertex Chat] Exception for ${modelName}:`, msg);

            if (
                /quota|exceeded|exhausted|overloaded|unavailable|try again later/i.test(
                    msg
                )
            ) {
                lastError = err;
                continue;
            }

            throw err;
        }
    }

    throw lastError || new Error('All Vertex models failed or returned empty.');
};

export default {
    async chat(ctx: any) {
        console.log('--- Vertex AI Chat (Strapi) body ---');
        console.log(JSON.stringify(ctx.request.body, null, 2));

        try {
            const { user, history = [], newMessage } = ctx.request.body || {};

            if (!user) {
                return ctx.badRequest('Thiếu thông tin khách hàng (user).');
            }

            // ===== Rate limit per user =====
            const rate = checkRateLimit(user, ctx);
            if (!rate.allowed) {
                return ctx.badRequest(
                    'Bạn đã dùng hết 50 lượt hỏi AI trong 24 giờ. Vui lòng thử lại sau.'
                );
            }

            const contents = buildContentsForVertex(user, history, newMessage);
            const textResponse = await generateWithVertex(contents);

            return { text: textResponse };
        } catch (error: any) {
            console.error('--- Error in Vertex AI chat ---');
            console.error(error);

            const msg = String(
                error?.message || 'AI đang quá tải, vui lòng thử lại sau.'
            );

            if (
                /overloaded|try again later|unavailable|All Vertex models failed/i.test(
                    msg
                )
            ) {
                return ctx.badRequest(
                    'AI đang quá tải hoặc dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.'
                );
            }

            return ctx.badRequest('Không thể kết nối AI. Vui lòng thử lại sau.');
        }
    },
};
