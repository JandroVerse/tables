import { tables } from "@db/schema";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@db";

async function generateQRCode(restaurantId: number, tableId: number) {
  // Get the base URL from environment or use a default for development
  const baseUrl = process.env.BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  const tableUrl = `${baseUrl}/table/${restaurantId}/${tableId}`;

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
  // First create the table to get its ID
  const [table] = await db
    .insert(tables)
    .values({
      restaurantId,
      name,
      position,
      qrCode: '', // Temporary empty QR code
    })
    .returning();

  // Generate QR code using the new table's ID
  const qrCode = await generateQRCode(restaurantId, table.id);

  // Update the table with the QR code
  const [updatedTable] = await db
    .update(tables)
    .set({ qrCode })
    .where(eq(tables.id, table.id))
    .returning();

  return updatedTable;
}