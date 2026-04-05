import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { TranslationService, TranslationOptions } from "./translationService";

export class GeminiService implements TranslationService {
  private apiKey?: string;
  private modelName: string;

  constructor(apiKey?: string, modelName: string = "gemini-3-flash-preview") {
    this.modelName = modelName;
    this.apiKey = apiKey;
    console.log(`GeminiService initialized with model ${modelName}`);
  }

  private getAIInstance(): any {
    // Priority: 1. Manual Key from UI, 2. Environment Key from AI Studio
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    const key = (this.apiKey && this.apiKey.trim() !== "") ? this.apiKey : envKey;
    
    if (key && key.trim() !== "" && key !== "MY_GEMINI_API_KEY") {
      try {
        return new GoogleGenAI({ apiKey: key });
      } catch (e) {
        console.error("Failed to initialize GoogleGenAI:", e);
      }
    }
    return null;
  }

  async hasApiKey(): Promise<boolean> {
    if (this.apiKey && this.apiKey.trim() !== "") return true;
    
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (envKey && envKey.trim() !== "" && envKey !== "MY_GEMINI_API_KEY") return true;
    
    if (typeof window !== 'undefined' && (window as any).aistudio?.hasSelectedApiKey) {
      return await (window as any).aistudio.hasSelectedApiKey();
    }

    return false;
  }

  async openKeySelection(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
    }
  }

  async *translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string> {
    const { imageBuffer, pageNumber, signal } = options;
    
    if (signal?.aborted) {
      throw new Error("Translation aborted");
    }

    const ai = this.getAIInstance();
    if (!ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là chuyên gia dịch thuật Y khoa (Medical Translation).
      Dịch hình ảnh sang tiếng Việt, giữ nguyên định dạng Markdown (tiêu đề, bảng, danh sách).
      Sử dụng thuật ngữ chuyên ngành chuẩn. Không thêm lời dẫn hay giải thích.
    `;

    const prompt = `Đây là trang ${pageNumber} của một tài liệu y khoa. Hãy dịch toàn bộ nội dung trong hình ảnh này sang tiếng Việt một cách chuyên nghiệp.`;

    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) {
        throw new Error("Translation aborted");
      }
      try {
        const response = await ai.models.generateContentStream({
          model: this.modelName,
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/webp",
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
          if (signal?.aborted) {
            throw new Error("Translation aborted");
          }
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
        const isUnavailableError = error.message?.toLowerCase().includes("unavailable") || 
                                 error.message?.toLowerCase().includes("503") ||
                                 error.message?.toLowerCase().includes("high demand");
        
        if ((isQuotaError || isUnavailableError) && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
          const errorType = isQuotaError ? "Quota exceeded" : "Model unavailable (503)";
          console.warn(`${errorType}. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Pro Streaming Error:", error);
        
        if (error.message?.includes("API key not valid")) {
          throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
        }
        if (isQuotaError) {
          throw new Error(`Bạn đã hết hạn mức sử dụng API (Quota exceeded). 
            Nếu bạn dùng gói miễn phí, giới hạn là 15 yêu cầu/phút. 
            Lỗi chi tiết: ${error.message || "Resource exhausted"}.
            Vui lòng đợi 1 phút hoặc kiểm tra lại API Key trong phần Cài đặt.`);
        }
        if (isUnavailableError) {
          throw new Error("Hệ thống đang quá tải do nhu cầu sử dụng cao. Vui lòng thử lại sau giây lát.");
        }
        throw new Error(`Lỗi dịch thuật: ${error.message || "Không rõ nguyên nhân"}`);
      }
    }
  }

  async translateMedicalPage(options: TranslationOptions): Promise<string> {
    const { imageBuffer, pageNumber, signal } = options;
    
    if (signal?.aborted) {
      throw new Error("Translation aborted");
    }

    const ai = this.getAIInstance();
    if (!ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là chuyên gia dịch thuật Y khoa (Medical Translation).
      Dịch hình ảnh sang tiếng Việt, giữ nguyên định dạng Markdown (tiêu đề, bảng, danh sách).
      Sử dụng thuật ngữ chuyên ngành chuẩn. Không thêm lời dẫn hay giải thích.
    `;

    const prompt = `Đây là trang ${pageNumber} của một tài liệu y khoa. Hãy dịch toàn bộ nội dung trong hình ảnh này sang tiếng Việt một cách chuyên nghiệp.`;

    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) {
        throw new Error("Translation aborted");
      }
      try {
        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/webp",
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
        const isUnavailableError = error.message?.toLowerCase().includes("unavailable") || 
                                 error.message?.toLowerCase().includes("503") ||
                                 error.message?.toLowerCase().includes("high demand");
        
        if ((isQuotaError || isUnavailableError) && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
          const errorType = isQuotaError ? "Quota exceeded" : "Model unavailable (503)";
          console.warn(`${errorType}. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Translation Error:", error);
        
        if (error.message?.includes("API key not valid")) {
          throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
        }
        if (isQuotaError) {
          throw new Error(`Bạn đã hết hạn mức sử dụng API (Quota exceeded). 
            Nếu bạn dùng gói miễn phí, giới hạn là 15 yêu cầu/phút. 
            Lỗi chi tiết: ${error.message || "Resource exhausted"}.
            Vui lòng đợi 1 phút hoặc kiểm tra lại API Key trong phần Cài đặt.`);
        }
        if (isUnavailableError) {
          throw new Error("Hệ thống đang quá tải do nhu cầu sử dụng cao. Vui lòng thử lại sau giây lát.");
        }
        throw new Error(`Lỗi dịch thuật: ${error.message || "Không rõ nguyên nhân"}`);
      }
    }
    return "Lỗi: Quá số lần thử lại.";
  }

  async lookupMedicalTerm(term: string): Promise<any> {
    const ai = this.getAIInstance();

    if (!ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là một chuyên gia ngôn ngữ và từ điển y khoa cao cấp.
      Nhiệm vụ của bạn là cung cấp định nghĩa chính xác, dịch nghĩa, từ đồng nghĩa và các thuật ngữ liên quan cho từ hoặc cụm từ được cung cấp.
      
      YÊU CẦU:
      1. Ngôn ngữ: Tiếng Việt.
      2. Nếu là thuật ngữ y khoa, hãy cung cấp định nghĩa chuyên môn sâu.
      3. Nếu là từ ngữ thông thường, hãy dịch nghĩa và giải thích cách dùng trong ngữ cảnh y khoa nếu có.
      4. Cung cấp các từ đồng nghĩa và thuật ngữ liên quan để người dùng hiểu rõ hơn.
      5. Tuyệt đối không được bịa đặt thông tin.
    `;

    const prompt = `Hãy tra cứu thuật ngữ y khoa sau: "${term}"`;

    const MAX_RETRIES = 2;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
        const isUnavailableError = error.message?.toLowerCase().includes("unavailable") || 
                                 error.message?.toLowerCase().includes("503") ||
                                 error.message?.toLowerCase().includes("high demand");
        
        if ((isQuotaError || isUnavailableError) && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
          const errorType = isQuotaError ? "Quota exceeded" : "Model unavailable (503)";
          console.warn(`${errorType} for lookup. Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (isQuotaError) {
          throw new Error(`Bạn đã hết hạn mức sử dụng API (Quota exceeded). 
            Nếu bạn dùng gói miễn phí, giới hạn là 15 yêu cầu/phút. 
            Lỗi chi tiết: ${error.message || "Resource exhausted"}.
            Vui lòng đợi 1 phút hoặc kiểm tra lại API Key trong phần Cài đặt.`);
        }
        if (isUnavailableError) {
          throw new Error("Hệ thống đang quá tải do nhu cầu sử dụng cao. Vui lòng thử lại sau giây lát.");
        }
        throw new Error(`Lỗi tra cứu: ${error.message || "Không rõ nguyên nhân"}`);
      }
    }
  }

  async performOCR(imageBuffer: string): Promise<string> {
    const ai = this.getAIInstance();

    if (!ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Bạn là một chuyên gia OCR (Nhận diện ký tự quang học) y khoa.
      Nhiệm vụ của bạn là trích xuất CHÍNH XÁC văn bản từ hình ảnh vùng được chọn.
      
      YÊU CẦU:
      1. Chỉ trả về văn bản được trích xuất, không thêm lời dẫn, không giải thích.
      2. Nếu vùng chọn chứa thuật ngữ y khoa, hãy trích xuất chính xác thuật ngữ đó.
      3. Nếu vùng chọn chứa nhiều dòng, hãy nối chúng lại thành một chuỗi văn bản hợp lý.
      4. Nếu không tìm thấy văn bản nào, hãy trả về chuỗi rỗng.
    `;

    const prompt = "Hãy trích xuất văn bản từ hình ảnh này.";

    try {
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/webp",
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
        }
      });

      return response.text?.trim() || "";
    } catch (error: any) {
      console.error("Gemini OCR Error:", error);
      throw new Error(`Lỗi OCR: ${error.message || "Không rõ nguyên nhân"}`);
    }
  }
}
