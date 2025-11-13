'use strict';
// Import GoogleGenAI
const { GoogleGenAI } = require('@google/genai');

// Lấy API Key từ file .env của Strapi
const API_KEY = process.env.GOOGLE_API_KEY; 
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Hàm prompt (Tương tự file cũ, nhưng thêm tên 'KimHanh_II AI')
const getFengShuiPrompt = (user) => {
    let prompt = `Bạn là KimHanh_II AI, một chuyên gia phong thủy Việt Nam chuyên sâu về trang sức vàng. Hãy đưa ra lời khuyên cho khách hàng. Phân tích mệnh, tuổi... để gợi ý loại vàng, kiểu dáng phù hợp. Viết bằng tiếng Việt, giọng văn trang trọng và am hiểu.\n\n`;
    prompt += `**Thông tin khách hàng:**\n`;
    prompt += `- **Họ và tên:** ${user.primary.name}\n`;
    prompt += `- **Ngày tháng năm sinh:** ${user.primary.dob}\n`;
    if (user.purchaseType === 'wedding' && user.partner) {
        prompt += `\n**Thông tin người phối ngẫu (vợ/chồng):**\n`;
        prompt += `- **Họ và tên:** ${user.partner.name}\n`;
        prompt += `- **Ngày tháng năm sinh:** ${user.partner.dob}\n\n`;
        prompt += `Đây là trang sức cưới, hãy tư vấn để hòa hợp cho cả hai vợ chồng.`;
    }
    return prompt;
};

module.exports = {
  // Hàm này sẽ xử lý chat
  async chat(ctx) {
    try {
      const { user, history, newMessage } = ctx.request.body;

      if (newMessage) {
        // Đây là một tin nhắn tiếp theo
        const contents = history.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }));
        contents.push({ role: 'user', parts: [{ text: newMessage }] });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents
        });
        return { text: response.text };
      } else {
        // Đây là tin nhắn đầu tiên (lấy tư vấn ban đầu)
        const prompt = getFengShuiPrompt(user);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return { text: response.text };
      }
    } catch (error) {
      console.error("Error in AI chat:", error);
      return ctx.badRequest('Lỗi khi kết nối với trợ lý AI.');
    }
  },
};
