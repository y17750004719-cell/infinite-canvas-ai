import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const LOG_ALL_REQUESTS = process.env.LOG_ALL_REQUESTS !== '0';
const log = (...args: unknown[]) => {
  if (LOG_ALL_REQUESTS) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    log('[API][REQ]', { route: '/api/upload', method: 'POST', url: request.url });
    const body = await request.json();
    const { imageData, fileName } = body;

    if (!imageData) {
      log('[API][RES]', { route: '/api/upload', method: 'POST', status: 400, reason: 'imageData is required', durationMs: Date.now() - startedAt });
      return NextResponse.json(
        { error: 'Image data is required' },
        { status: 400 }
      );
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const ext = fileName?.match(/\.(\w+)$/)?.[1] || 'png';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const newFileName = `img-${timestamp}-${random}.${ext}`;
    const filePath = path.join(uploadsDir, newFileName);

    fs.writeFileSync(filePath, buffer);

    const url = `/uploads/${newFileName}`;

    log('[API][RES]', {
      route: '/api/upload',
      method: 'POST',
      status: 200,
      fileName: newFileName,
      sizeBytes: buffer.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      url,
      fileName: newFileName,
    });
  } catch (error) {
    console.error('Upload error:', error);
    log('[API][RES]', { route: '/api/upload', method: 'POST', status: 500, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
