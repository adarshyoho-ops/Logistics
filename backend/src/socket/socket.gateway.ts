import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Injectable, Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SocketGateway.name);
  private connectedSockets = new Map<string, Socket>();

  constructor(private jwtService: JwtService) {}

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token || typeof token !== 'string') {
        this.logger.warn('Socket connection rejected: No token provided');
        socket.disconnect();
        return;
      }

      // Verify token
      const payload = this.jwtService.verify(token);
      socket.data.user = payload;
      const userId = payload.sub;

      this.connectedSockets.set(userId, socket);
      
      // Join rooms
      await socket.join(`user:${userId}`);
      if (payload.role === 'admin') {
        await socket.join('admins');
      } else if (payload.role === 'rider') {
        await socket.join('riders');
      } else if (payload.role === 'client') {
        await socket.join('clients');
      }

      this.logger.log(`Socket connected: User ${userId} (Role: ${payload.role})`);
    } catch (error) {
      this.logger.error('Socket authentication failed:', error);
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket) {
    if (socket.data.user) {
      const userId = socket.data.user.sub;
      this.connectedSockets.delete(userId);
      this.logger.log(`Socket disconnected: User ${userId}`);
    }
  }

  emitToUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToAdmins(event: string, data: unknown) {
    this.server.to('admins').emit(event, data);
  }

  emitToAll(event: string, data: unknown) {
    this.server.emit(event, data);
  }
}
