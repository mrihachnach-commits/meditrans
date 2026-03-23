import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export class GeminiService {
  private ai: any;
  private modelName: string = "gemini-3-flash-preview"; 

  constructor(apiKey?: string) {
    // Priority: 1. Manual Key from UI, 2. Environment Key from AI Studio
    const envKey = process.env.GEMINI_API_KEY;
    const key = (apiKey && apiKey.trim() !== "") ? apiKey : envKey;
    
    // Check if it's a valid key and not a placeholder
    if (key && key !== "MY_GEMINI_API_KEY" && key.trim() !== "") {
      try {
        this.ai = new GoogleGenAI({ apiKey: key });
        console.log("GeminiService initialized with API Key.");
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
      return await (window as any).aistudio.hasSelectedApiKey();
    }
    
    return false;
  }

  async openKeySelection(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      // After selection, we might need to re-initialize
      const envKey = process.env.GEMINI_API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }
  }

  async *translateMedicalPageStream(imageBuffer: string, pageNumber: number): AsyncGenerator<string> {
    // Re-check for key if not initialized (might have been selected via platform)
    if (!this.ai) {
      const envKey = process.env.GEMINI_API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }

    if (!this.ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Dịch tài liệu y khoa (Nhãn khoa) sang tiếng Việt.
      - Thuật ngữ: Chuẩn y khoa Việt Nam.
      - Định dạng: Markdown (giữ tiêu đề, bảng, danh sách).
      - Hình ảnh: Dịch chú thích (ví dụ: Fig 1.2).
      - Chỉ trả về nội dung dịch. Không giải thích.
    `;

    const prompt = `Dịch trang ${pageNumber}`;

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
    } catch (error: any) {
      console.error("Gemini Pro Streaming Error:", error);
      
      if (error.message?.includes("API key not valid")) {
        throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
      }
      if (error.message?.includes("quota")) {
        throw new Error("Hết hạn mức API (Quota exceeded). Vui lòng thử lại sau.");
      }
      throw new Error(`Lỗi dịch thuật: ${error.message || "Không rõ nguyên nhân"}`);
    }
  }

  async translateMedicalPage(imageBuffer: string, pageNumber: number): Promise<string> {
    // Re-check for key if not initialized (might have been selected via platform)
    if (!this.ai) {
      const envKey = process.env.GEMINI_API_KEY;
      if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey.trim() !== "") {
        this.ai = new GoogleGenAI({ apiKey: envKey });
      }
    }

    if (!this.ai) {
      throw new Error("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Cài đặt hoặc chọn API Key từ hệ thống.");
    }

    const systemInstruction = `
      Dịch tài liệu y khoa (Nhãn khoa) sang tiếng Việt.
      - Thuật ngữ: Chuẩn y khoa Việt Nam.
      - Định dạng: Markdown (giữ tiêu đề, bảng, danh sách).
      - Hình ảnh: Dịch chú thích (ví dụ: Fig 1.2).
      - Chỉ trả về nội dung dịch. Không giải thích.
    `;

    const prompt = `Dịch trang ${pageNumber}`;

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
      console.error("Gemini Translation Error:", error);
      
      if (error.message?.includes("API key not valid")) {
        throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
      }
      if (error.message?.includes("quota")) {
        throw new Error("Hết hạn mức API (Quota exceeded). Vui lòng thử lại sau.");
      }
      throw new Error(`Lỗi dịch thuật: ${error.message || "Không rõ nguyên nhân"}`);
    }
  }
}
