'use strict';

// ===== Vertex AI (via GoogleAuth) =====
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID =
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    '';
const REGION = (process.env.VERTEX_REGION || 'us-central1').trim();

// Ưu tiên model giống ALLMYNE, có thể chỉnh trong .env
const MODEL_PRIORITY = (process.env.VERTEX_GEMINI_PRIORITY ||
    'gemini-2.5-flash,gemini-1.5-flash,gemini-1.0-pro')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

if (!PROJECT_ID) {
    console.warn('[Vertex Chat] Missing GOOGLE_CLOUD_PROJECT_ID env');
}
if (!REGION) {
    console.warn('[Vertex Chat] Missing VERTEX_REGION env');
}

// Lấy access token từ service account (GOOGLE_APPLICATION_CREDENTIALS)
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

// ===== Prompt phong thủy (giữ logic từ FE) =====
const getFengShuiPrompt = (user: any): string => {
    let prompt =
        'Bạn là KimHanh_II AI, một chuyên gia phong thủy Việt Nam chuyên sâu về trang sức vàng. ' +
        'Hãy đưa ra lời khuyên cho khách hàng dựa trên thông tin sau. ' +
        'Phân tích mệnh, tuổi, và các yếu tố tương sinh, tương khắc để gợi ý loại vàng, kiểu dáng, và họa tiết trang sức phù hợp nhất ' +
        'để mang lại may mắn, tài lộc, và hạnh phúc. Viết bằng tiếng Việt, giọng văn trang trọng và am hiểu.\n\n';

    prompt += '**Thông tin khách hàng:**\n';
    prompt += `- **Họ và tên:** ${user?.primary?.name || 'Không rõ'}\n`;
    prompt += `- **Ngày tháng năm sinh:** ${user?.primary?.dob || 'Không rõ'}\n`;

    if (user?.purchaseType === 'wedding' && user?.partner) {
        prompt += '\n**Thông tin người phối ngẫu (vợ/chồng):**\n';
        prompt += `- **Họ và tên:** ${user.partner.name || 'Không rõ'}\n`;
        prompt += `- **Ngày tháng năm sinh:** ${user.partner.dob || 'Không rõ'}\n\n`;
        prompt += 'Đây là trang sức cưới, hãy tư vấn để hòa hợp cho cả hai vợ chồng.';
    } else {
        prompt += '\nĐây là trang sức mua cho cá nhân.';
    }

    return prompt;
};

// ===== Convert body FE -> Vertex contents =====
const buildContentsForVertex = (
    user: any,
    history: any[] = [],
    newMessage?: string
) => {
    // Nếu có newMessage & history: coi như chat tiếp
    if (newMessage && history.length > 0) {
        const contents = history.map((msg: any) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content || '' }],
        }));

        contents.push({
            role: 'user',
            parts: [{ text: newMessage }],
        });

        return contents;
    }

    // Lần đầu: dùng prompt phong thủy
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

                // Lỗi cho phép fallback: 429 / 500 / 503 / UNAVAILABLE...
                if ([429, 500, 503].includes(res.status)) {
                    lastError = new Error(
                        `Vertex overloaded (${res.status}) for ${modelName}: ${text}`
                    );
                    continue;
                }

                // Lỗi khác: dừng luôn
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

            // Nếu lỗi kiểu quá tải / quota / unavailable → cho phép fallback
            if (
                /quota|exceeded|exhausted|overloaded|unavailable|try again later/i.test(
                    msg
                )
            ) {
                lastError = err;
                continue;
            }

            // Lỗi khác: dừng luôn
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
