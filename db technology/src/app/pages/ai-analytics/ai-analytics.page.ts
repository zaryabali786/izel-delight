import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  sparklesOutline,
  flashOutline,
  videocamOutline,
  trendingUpOutline,
  navigateOutline,
  refreshOutline,
  bulbOutline,
  alertCircleOutline,
  rocketOutline,
  shieldCheckmarkOutline,
  informationCircleOutline,
  syncOutline,
  hardwareChipOutline,
  chatbubblesOutline,
  warningOutline,
  checkmarkCircle,
  megaphoneOutline,
  cubeOutline,
  cashOutline,
  micOutline,
  walletOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';

@Component({
  selector: 'app-ai-analytics',
  templateUrl: './ai-analytics.page.html',
  styleUrls: ['./ai-analytics.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class AiAnalyticsPage {
  constructor(public analytics: AnalyticsService) {
    addIcons({
      sparklesOutline,
      flashOutline,
      videocamOutline,
      trendingUpOutline,
      navigateOutline,
      refreshOutline,
      bulbOutline,
      alertCircleOutline,
      rocketOutline,
      shieldCheckmarkOutline,
      informationCircleOutline,
      syncOutline,
      hardwareChipOutline,
      chatbubblesOutline,
      warningOutline,
      checkmarkCircle,
      megaphoneOutline,
      cubeOutline,
      cashOutline,
      micOutline,
      walletOutline
    });
  }

  async runAiAudit(): Promise<void> {
    await this.analytics.refreshGrowthInsights();
  }

  getPlatformRecommendation(platformName: string): string {
    const list = this.analytics.aiGrowthInsights()?.channelPerformance || [];
    const found = list.find((p) => p.platform.toLowerCase().includes(platformName.slice(0, 4).toLowerCase()));
    return found?.recommendation || 'Maintain budget allocation.';
  }

  getPlatformStatus(platformName: string): string {
    const list = this.analytics.aiGrowthInsights()?.channelPerformance || [];
    const found = list.find((p) => p.platform.toLowerCase().includes(platformName.slice(0, 4).toLowerCase()));
    return found?.status || 'maintain';
  }

  getCourierAdvice(courierName: string): string {
    const list = this.analytics.aiGrowthInsights()?.courierTelemetry || [];
    const found = list.find((c) => c.courier.toLowerCase().includes(courierName.slice(0, 4).toLowerCase()));
    return found?.routingAdvice || 'Optimal routing active.';
  }

  getCourierRating(courierName: string): string {
    const list = this.analytics.aiGrowthInsights()?.courierTelemetry || [];
    const found = list.find((c) => c.courier.toLowerCase().includes(courierName.slice(0, 4).toLowerCase()));
    return found?.rating || 'Optimal';
  }
}
