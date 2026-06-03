import { Controller, Get, UseGuards } from '@nestjs/common';
import { AnalyticsService, AnalyticsSummary } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @Roles('admin')
  async getSummary(): Promise<AnalyticsSummary> {
    return this.analyticsService.getSummary();
  }
}
