import { tables } from "@db/schema";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@db";
import { nanoid } from "nanoid";

async function generateQRCode(token: string) {
  // Get the base URL from environment or use a default for development
  const baseUrl = process.env.BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  const tableUrl = `${baseUrl}/table/${token}`;

  try {
    return await QRCode.toString(tableUrl, {
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
  // Generate a unique token for the table
  const token = nanoid();

  // Generate QR code with the token
  const qrCode = await generateQRCode(token);

  // Create the table with token
  const [table] = await db
    .insert(tables)
    .values({
      restaurantId,
      name,
      position,
      token,
      qrCode,
    })
    .returning();

  return table;
}