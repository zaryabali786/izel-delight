import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  trendingUpOutline,
  walletOutline,
  calendarOutline,
  checkmarkCircle,
  timeOutline,
  informationCircleOutline,
  shieldCheckmarkOutline,
  rocketOutline,
  sparklesOutline,
  refreshOutline,
  cubeOutline,
  syncOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';

@Component({
  selector: 'app-growth-deck',
  templateUrl: './growth-deck.page.html',
  styleUrls: ['./growth-deck.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class GrowthDeckPage {
  constructor(public analytics: AnalyticsService) {
    addIcons({
      trendingUpOutline,
      walletOutline,
      calendarOutline,
      checkmarkCircle,
      timeOutline,
      informationCircleOutline,
      shieldCheckmarkOutline,
      rocketOutline,
      sparklesOutline,
      refreshOutline,
      cubeOutline,
      syncOutline
    });
  }

  currentRevenue = computed(() => {
    return this.analytics.storeMetricsData()?.gross_revenue || 0;
  });

  hasData = computed(() => {
    const metrics = this.analytics.storeMetricsData();
    const orders = this.analytics.storeOrders();
    return (metrics?.has_sufficient_data && this.currentRevenue() > 0) || orders.length > 0;
  });

  targetRevenue = computed(() => {
    const base = this.currentRevenue() || 500000;
    const scenario = this.analytics.growthScenario();
    if (scenario === 'conservative') return Math.round(base * 1.35);
    if (scenario === 'target') return Math.round(base * 1.85);
    return Math.round(base * 2.5);
  });

  projectedProfit = computed(() => {
    return Math.round(this.targetRevenue() * 0.28);
  });

  starProducts = computed(() => {
    return this.analytics.catalogProducts().slice(0, 3);
  });

  optimizeProducts = computed(() => {
    return this.analytics.catalogProducts().slice(3, 6);
  });
}
