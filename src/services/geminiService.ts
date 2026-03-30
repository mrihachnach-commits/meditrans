import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { TranslationService, TranslationOptions } from "./translationService";

export class GeminiService implements TranslationService {
  private ai: any;
  private modelName: string;

  constructor(apiKey?: string, modelName: string = "gemini-3-flash-preview") {
    this.modelName = modelName;
    // Priority: 1. Manual Key from UI, 2. Environment Key from AI Studio
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const key = (apiKey && apiKey.trim() !== "") ? apiKey : envKey;
    
    // Check if it's a valid key and not a placeholder
    if (key && key !== "MY_GEMINI_API_KEY" && key.trim() !== "") {
      try {
        this.ai = new GoogleGenAI({ apiKey: key });
        console.log(`GeminiService initialized with model ${modelName} and API Key.`);
      } catch (e) {
        console.error("Failed to initialize GoogleGenAI:", e);
      }
    } else {
      console.warn("No valid API Key found for GeminiService. Will check for platform key selection.");
    }
  }

  async hasApiKey(): Promise<boolean> {
    if (this.ai) return true;
    
    // Check if platform has a selected key
    if (typeof window !== 'undefined' && (window as any).aistudio?.hasSelectedApiKey) {
      const hasSelected = await (window as any).aistudio.hasSelectedApiKey();
      if (hasSelected) return true;
    }

    // Check environment key again (might have been updated)
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
      return true;
    }
    
    return false;
  }

  async openKeySelection(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      // After selection, we might need to re-initialize
      const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }
  }

  async *translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string> {
    const { imageBuffer, pageNumber } = options;
    // Re-check for key if not initialized (might have been selected via platform)
    if (!this.ai) {
      const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }

    if (!this.ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là một chuyên gia dịch thuật y khoa cao cấp, chuyên ngành Nhãn khoa (Ophthalmology).
      Nhiệm vụ của bạn là dịch hình ảnh trang tài liệu y khoa được cung cấp sang tiếng Việt.
      
      YÊU CẦU BẮT BUỘC:
      1. Dịch SÁT NGHĨA, ĐẦY ĐỦ và CHÍNH XÁC toàn bộ văn bản trong hình ảnh. Không được bỏ sót bất kỳ đoạn văn, tiêu đề hay chú thích nào.
      2. Sử dụng thuật ngữ y khoa Nhãn khoa chuẩn Việt Nam (ví dụ: "Retina" -> "Võng mạc", "Glaucoma" -> "Cườm nước/Glôcôm", "Cataract" -> "Đục thủy tinh thể").
      3. Giữ nguyên định dạng Markdown:
         - Sử dụng các cấp độ tiêu đề (#, ##, ###) tương ứng với tài liệu gốc.
         - Giữ nguyên cấu trúc bảng (tables), danh sách (lists), và các đoạn văn.
         - Dịch chú thích hình ảnh (ví dụ: "Figure 1.1" -> "Hình 1.1").
      4. KHÔNG thêm lời dẫn, không giải thích, không nhận xét. Chỉ trả về nội dung đã được dịch.
      5. Nếu có các ký hiệu đặc biệt hoặc công thức, hãy giữ nguyên hoặc trình bày lại một cách dễ hiểu nhất trong Markdown.
    `;

    const prompt = `Đây là trang ${pageNumber} của một tài liệu y khoa chuyên ngành Nhãn khoa. Hãy dịch toàn bộ nội dung trong hình ảnh này sang tiếng Việt một cách chuyên nghiệp.`;

    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        const response = await this.ai.models.generateContentStream({
          model: this.modelName,
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: imageBuffer.split(",")[1],
                  },
                },
              ],
            },
          ],
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
          }
        });

        let fullText = "";
        for await (const chunk of response) {
          const chunkText = chunk.text;
          if (chunkText) {
            fullText += chunkText;
            yield chunkText;
          }
        }

        if (!fullText) {
          throw new Error("Model returned no text.");
        }
        
        // Success, break the retry loop
        break;

      } catch (error: any) {
        const isQuotaError = error.message?.toLowerCase().includes("quota") || 
                           error.message?.toLowerCase().includes("429") ||
                           error.message?.toLowerCase().includes("resource_exhausted");
        
        if (isQuotaError && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
          console.warn(`Quota exceeded. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Pro Streaming Error:", error);
        
        if (error.message?.includes("API key not valid")) {
          throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
        }
        if (isQuotaError) {
          throw new Error("Bạn đã hết hạn mức sử dụng API miễn phí trong lúc này. Vui lòng đợi khoảng 1 phút hoặc chuyển sang model 'Gemini 2.0 Flash' trong phần Cài đặt để tiếp tục.");
        }
        throw new Error(`Lỗi dịch thuật: ${error.message || "Không rõ nguyên nhân"}`);
      }
    }
  }

  async translateMedicalPage(options: TranslationOptions): Promise<string> {
    const { imageBuffer, pageNumber } = options;
    // Re-check for key if not initialized (might have been selected via platform)
    if (!this.ai) {
      const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }

    if (!this.ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là một chuyên gia dịch thuật y khoa cao cấp, chuyên ngành Nhãn khoa (Ophthalmology).
      Nhiệm vụ của bạn là dịch hình ảnh trang tài liệu y khoa được cung cấp sang tiếng Việt.
      
      YÊU CẦU BẮT BUỘC:
      1. Dịch SÁT NGHĨA, ĐẦY ĐỦ và CHÍNH XÁC toàn bộ văn bản trong hình ảnh. Không được bỏ sót bất kỳ đoạn văn, tiêu đề hay chú thích nào.
      2. Sử dụng thuật ngữ y khoa Nhãn khoa chuẩn Việt Nam (ví dụ: "Retina" -> "Võng mạc", "Glaucoma" -> "Cườm nước/Glôcôm", "Cataract" -> "Đục thủy tinh thể").
      3. Giữ nguyên định dạng Markdown:
         - Sử dụng các cấp độ tiêu đề (#, ##, ###) tương ứng với tài liệu gốc.
         - Giữ nguyên cấu trúc bảng (tables), danh sách (lists), và các đoạn văn.
         - Dịch chú thích hình ảnh (ví dụ: "Figure 1.1" -> "Hình 1.1").
      4. KHÔNG thêm lời dẫn, không giải thích, không nhận xét. Chỉ trả về nội dung đã được dịch.
      5. Nếu có các ký hiệu đặc biệt hoặc công thức, hãy giữ nguyên hoặc trình bày lại một cách dễ hiểu nhất trong Markdown.
    `;

    const prompt = `Đây là trang ${pageNumber} của một tài liệu y khoa chuyên ngành Nhãn khoa. Hãy dịch toàn bộ nội dung trong hình ảnh này sang tiếng Việt một cách chuyên nghiệp.`;

    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: imageBuffer.split(",")[1],
                  },
                },
              ],
            },
          ],
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
          }
        });

        return response.text || "Model returned no text.";
      } catch (error: any) {
        const isQuotaError = error.message?.toLowerCase().includes("quota") || 
                           error.message?.toLowerCase().includes("429") ||
                           error.message?.toLowerCase().includes("resource_exhausted");
        
        if (isQuotaError && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
          console.warn(`Quota exceeded. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Translation Error:", error);
        
        if (error.message?.includes("API key not valid")) {
          throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
        }
        if (isQuotaError) {
          throw new Error("Bạn đã hết hạn mức sử dụng API miễn phí trong lúc này. Vui lòng đợi khoảng 1 phút hoặc chuyển sang model 'Gemini 2.0 Flash' trong phần Cài đặt để tiếp tục.");
        }
        throw new Error(`Lỗi dịch thuật: ${error.message || "Không rõ nguyên nhân"}`);
      }
    }
    return "Lỗi: Quá số lần thử lại.";
  }

  async lookupMedicalTerm(term: string): Promise<any> {
    // Re-check for key if not initialized (might have been selected via platform)
    if (!this.ai) {
      const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }

    if (!this.ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là một chuyên gia ngôn ngữ và từ điển y khoa cao cấp.
      Nhiệm vụ của bạn là cung cấp định nghĩa chính xác, dịch nghĩa, từ đồng nghĩa và các thuật ngữ liên quan cho từ hoặc cụm từ được cung cấp.
      
      YÊU CẦU:
      1. Ngôn ngữ: Tiếng Việt.
      2. Nếu là thuật ngữ y khoa (đặc biệt là Nhãn khoa), hãy cung cấp định nghĩa chuyên môn sâu.
      3. Nếu là từ ngữ thông thường, hãy dịch nghĩa và giải thích cách dùng trong ngữ cảnh y khoa nếu có.
      4. Cung cấp các từ đồng nghĩa và thuật ngữ liên quan để người dùng hiểu rõ hơn.
      5. Tuyệt đối không được bịa đặt thông tin.
    `;

    const prompt = `Hãy tra cứu thuật ngữ y khoa sau: "${term}"`;

    const MAX_RETRIES = 2;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelName,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING, description: "BẮT BUỘC: Phải giống hệt với từ/cụm từ được tra cứu ở prompt" },
                definition: { type: Type.STRING, description: "Định nghĩa chi tiết hoặc dịch nghĩa bằng tiếng Việt" },
                synonyms: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "Danh sách các từ đồng nghĩa hoặc tên gọi khác"
                },
                relatedTerms: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "Các thuật ngữ y khoa liên quan mật thiết"
                },
                source: { type: Type.STRING, description: "Nguồn tham khảo uy tín" }
              },
              required: ["term", "definition", "synonyms", "relatedTerms"]
            }
          }
        });

        const text = response.text;
        if (!text) throw new Error("Model returned no text.");
        
        // Clean up potential markdown code blocks
        const cleanJson = text.replace(/```json\n?|```/g, '').trim();
        return JSON.parse(cleanJson);
      } catch (error: any) {
        const isQuotaError = error.message?.toLowerCase().includes("quota") || 
                           error.message?.toLowerCase().includes("429") ||
                           error.message?.toLowerCase().includes("resource_exhausted");
        
        if (isQuotaError && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
          console.warn(`Quota exceeded for lookup. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (isQuotaError) {
          throw new Error("Bạn đã hết hạn mức sử dụng API miễn phí trong lúc này. Vui lòng đợi khoảng 1 phút hoặc chuyển sang model 'Gemini 2.0 Flash' trong phần Cài đặt để tiếp tục.");
        }
        throw new Error(`Lỗi tra cứu: ${error.message || "Không rõ nguyên nhân"}`);
      }
    }
  }

  async performOCR(imageBuffer: string): Promise<string> {
    if (!this.ai) {
      const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }

    if (!this.ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là một chuyên gia OCR (Nhận diện ký tự quang học) y khoa chuyên ngành Nhãn khoa.
      Nhiệm vụ của bạn là trích xuất CHÍNH XÁC văn bản từ hình ảnh vùng được chọn.
      
      YÊU CẦU:
      1. Chỉ trả về văn bản được trích xuất, không thêm lời dẫn, không giải thích.
      2. Nếu vùng chọn chứa thuật ngữ y khoa, hãy trích xuất chính xác thuật ngữ đó.
      3. Nếu vùng chọn chứa nhiều dòng, hãy nối chúng lại thành một chuỗi văn bản hợp lý.
      4. Nếu không tìm thấy văn bản nào, hãy trả về chuỗi rỗng.
    `;

    const prompt = "Hãy trích xuất văn bản từ hình ảnh này.";

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageBuffer.split(",")[1],
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1,
        }
      });

      return response.text?.trim() || "";
    } catch (error: any) {
      console.error("Gemini OCR Error:", error);
      throw new Error(`Lỗi OCR: ${error.message || "Không rõ nguyên nhân"}`);
    }
  }
}
