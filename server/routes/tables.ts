import { tables } from "@db/schema";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";

async function generateQRCode(restaurantId: number, tableId: number) {
  // Get the base URL from environment or use a default for development
  const baseUrl = process.env.BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  const requestUrl = `${baseUrl}/table/${restaurantId}/${tableId}`;
  
  try {
    return await QRCode.toString(requestUrl, {
      type: 'svg',
      margin: 1,
      width: 256,
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
}

export async function createTable(restaurantId: number, name: string, position: any) {
  const qrCode = await generateQRCode(restaurantId, tableId);
  
  const [table] = await db
    .insert(tables)
    .values({
      restaurantId,
      name,
      position,
      qrCode,
    })
    .returning();
    
  return table;
}
