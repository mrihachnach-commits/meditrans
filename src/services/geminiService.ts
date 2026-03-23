import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  private ai: any;
  private modelName: string = "gemini-3.1-pro-preview"; 

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
      Bạn là một chuyên gia dịch thuật y khoa (Ophthalmology/Nhãn khoa) hàng đầu. 
      Nhiệm vụ của bạn là dịch các trang tài liệu y khoa từ tiếng Anh sang tiếng Việt.
      
      QUY TẮC LÀM VIỆC:
      1. Thuật ngữ chuyên môn: Sử dụng thuật ngữ y khoa chính xác, chuẩn xác theo y văn Việt Nam.
      2. Hình ảnh & Sơ đồ: Các hình ảnh trong trang là ảnh chụp đáy mắt (fundus photos) hoặc sơ đồ khoa học. Hãy dịch các chú thích (captions) đi kèm (ví dụ: Fig 1.23).
      3. Định dạng: Sử dụng Markdown để giữ nguyên cấu trúc trang (tiêu đề, đoạn văn, danh sách, bảng).
      4. Ngôn ngữ: Chỉ trả về nội dung đã dịch sang tiếng Việt. Không giải thích thêm.
      5. Độ chính xác: Đảm bảo dịch sát nghĩa các mô tả bệnh lý phức tạp.
    `;

    const prompt = `Hãy dịch trang tài liệu y khoa này (Trang số ${pageNumber}). Tập trung vào việc chuyển ngữ chính xác các thuật ngữ chuyên môn và chú thích hình ảnh.`;

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
          temperature: 0.1, // Lower temperature for more consistent medical translation
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ]
        }
      });

      if (!response.text) {
        // Fallback to a simpler model if Pro fails or returns empty
        console.warn("Pro model returned no text, trying Flash model...");
        return this.translateWithFlash(imageBuffer, pageNumber, systemInstruction);
      }

      return response.text;
    } catch (error: any) {
      console.error("Gemini Pro Translation Error:", error);
      
      // If it's a safety block or other error, try Flash as fallback
      try {
        return await this.translateWithFlash(imageBuffer, pageNumber, systemInstruction);
      } catch (fallbackError: any) {
        if (error.message?.includes("API key not valid")) {
          throw new Error("API Key không hợp lệ. Vui lòng kiểm tra lại trong phần Cài đặt.");
        }
        if (error.message?.includes("quota")) {
          throw new Error("Hết hạn mức API (Quota exceeded). Vui lòng thử lại sau.");
        }
        throw new Error(`Lỗi dịch thuật: ${fallbackError.message || error.message || "Không rõ nguyên nhân"}`);
      }
    }
  }

  private async translateWithFlash(imageBuffer: string, pageNumber: number, systemInstruction: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: `Dịch trang y khoa số ${pageNumber} sang tiếng Việt.` },
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
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ]
      }
    });

    return response.text || "Dịch thuật thất bại sau khi thử lại.";
  }
}
