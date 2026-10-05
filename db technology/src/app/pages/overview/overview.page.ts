import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  gridOutline,
  arrowForwardOutline,
  sparklesOutline,
  trendingUpOutline,
  shieldCheckmarkOutline,
  cubeOutline,
  cartOutline,
  logoWhatsapp,
  bagHandleOutline,
  checkmarkCircleOutline,
  timeOutline,
  cashOutline,
  cardOutline,
  openOutline,
  chatbubblesOutline,
  alertCircleOutline,
  informationCircleOutline,
  layersOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StoreService } from '../../core/services/store.service';
import { StoreOrder } from '../../core/models/analytics.models';

@Component({
  selector: 'app-overview',
  templateUrl: './overview.page.html',
  styleUrls: ['./overview.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon]
})
export class OverviewPage {
  orderChannelFilter = signal<'all' | 'shopify' | 'whatsapp'>('all');

  filteredOrders = computed(() => {
    const list = this.analytics.storeOrders();
    const filter = this.orderChannelFilter();
    if (filter === 'all') return list;
    return list.filter((o) => o.channel === filter);
  });

  shopifyOrdersCount = computed(() => {
    return this.analytics.storeOrders().filter((o) => o.channel === 'shopify').length;
  });

  whatsappOrdersCount = computed(() => {
    return this.analytics.storeOrders().filter((o) => o.channel === 'whatsapp').length;
  });

  constructor(
    public analytics: AnalyticsService,
    public storeService: StoreService
  ) {
    addIcons({
      gridOutline,
      arrowForwardOutline,
      sparklesOutline,
      trendingUpOutline,
      shieldCheckmarkOutline,
      cubeOutline,
      cartOutline,
      logoWhatsapp,
      bagHandleOutline,
      checkmarkCircleOutline,
      timeOutline,
      cashOutline,
      cardOutline,
      openOutline,
      chatbubblesOutline,
      alertCircleOutline,
      informationCircleOutline,
      layersOutline
    });
  }

  setOrderChannelFilter(channel: 'all' | 'shopify' | 'whatsapp'): void {
    this.orderChannelFilter.set(channel);
  }

  openWhatsAppConversationModal(): void {
    this.analytics.openWhatsAppModal();
  }
}
