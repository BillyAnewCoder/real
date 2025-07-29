import { type ExtractionResult, type ExtractedFile } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  createExtractionResult(url: string): Promise<ExtractionResult>;
  getExtractionResult(id: string): Promise<ExtractionResult | undefined>;
  updateExtractionResult(id: string, updates: Partial<ExtractionResult>): Promise<ExtractionResult>;
  addFileToExtraction(extractionId: string, file: ExtractedFile): Promise<void>;
}

export class MemStorage implements IStorage {
  private extractions: Map<string, ExtractionResult>;

  constructor() {
    this.extractions = new Map();
  }

  async createExtractionResult(url: string): Promise<ExtractionResult> {
    const id = randomUUID();
    const result: ExtractionResult = {
      id,
      url,
      status: "pending",
      files: [],
      totalSize: 0,
      totalFiles: 0,
      extractedAt: new Date().toISOString(),
    };
    this.extractions.set(id, result);
    return result;
  }

  async getExtractionResult(id: string): Promise<ExtractionResult | undefined> {
    return this.extractions.get(id);
  }

  async updateExtractionResult(id: string, updates: Partial<ExtractionResult>): Promise<ExtractionResult> {
    const existing = this.extractions.get(id);
    if (!existing) {
      throw new Error("Extraction not found");
    }
    const updated = { ...existing, ...updates };
    this.extractions.set(id, updated);
    return updated;
  }

  async addFileToExtraction(extractionId: string, file: ExtractedFile): Promise<void> {
    const extraction = this.extractions.get(extractionId);
    if (!extraction) {
      throw new Error("Extraction not found");
    }
    extraction.files.push(file);
    extraction.totalFiles = extraction.files.length;
    extraction.totalSize = extraction.files.reduce((sum, f) => sum + f.size, 0);
    this.extractions.set(extractionId, extraction);
  }
}

export const storage = new MemStorage();
