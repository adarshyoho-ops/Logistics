import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger('NotificationService');

  notifyClient(clientName: string, orderId: string, message: string): void {
    console.log(`[NOTIFY] Client ${clientName}: Your order #${orderId} ${message}`);
  }

  notifyRider(riderName: string, orderId: string, message: string): void {
    console.log(`[NOTIFY] Rider ${riderName}: New order #${orderId} ${message}`);
  }

  notifyAdmin(message: string): void {
    console.log(`[NOTIFY] Admin: ${message}`);
  }
}
