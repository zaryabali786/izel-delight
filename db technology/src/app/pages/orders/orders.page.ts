import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  receiptOutline,
  bagHandleOutline,
  logoWhatsapp,
  filterOutline,
  searchOutline,
  cubeOutline,
  syncOutline,
  shieldCheckmarkOutline,
  informationCircleOutline,
  chevronForwardOutline,
  checkmarkCircle,
  timeOutline,
  alertCircleOutline,
  chatbubblesOutline,
  navigateOutline,
  cashOutline,
  cardOutline,
  arrowForwardOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StoreService } from '../../core/services/store.service';
import { StoreOrder } from '../../core/models/analytics.models';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class OrdersPage {
  activeFilter = signal<'all' | 'whatsapp' | 'shopify'>('all');
  searchQuery = signal<string>('');

  constructor(
    public analytics: AnalyticsService,
    public storeService: StoreService
  ) {
    addIcons({
      receiptOutline,
      bagHandleOutline,
      logoWhatsapp,
      filterOutline,
      searchOutline,
      cubeOutline,
      syncOutline,
      shieldCheckmarkOutline,
      informationCircleOutline,
      chevronForwardOutline,
      checkmarkCircle,
      timeOutline,
      alertCircleOutline,
      chatbubblesOutline,
      navigateOutline,
      cashOutline,
      cardOutline,
      arrowForwardOutline
    });
  }

  activeStore = computed(() => this.storeService.activeStore());

  totalOrdersCount = computed(() => this.analytics.storeOrders().length);

  whatsappOrdersCount = computed(() => {
    return this.analytics.storeOrders().filter((o) => o.channel === 'whatsapp').length;
  });

  shopifyOrdersCount = computed(() => {
    return this.analytics.storeOrders().filter((o) => o.channel === 'shopify').length;
  });

  totalRevenue = computed(() => {
    return this.analytics.storeOrders().reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
  });

  filteredOrders = computed(() => {
    const list = this.analytics.storeOrders();
    const filter = this.activeFilter();
    const query = this.searchQuery().toLowerCase().trim();

    return list.filter((order: StoreOrder) => {
      const matchesFilter = filter === 'all' || order.channel === filter;
      const matchesQuery =
        !query ||
        order.order_number.toLowerCase().includes(query) ||
        order.customer_name.toLowerCase().includes(query) ||
        order.customer_phone.toLowerCase().includes(query) ||
        order.city?.toLowerCase().includes(query) ||
        (order.items || []).some((i) => i.title.toLowerCase().includes(query));

      return matchesFilter && matchesQuery;
    });
  });

  setFilter(filter: 'all' | 'whatsapp' | 'shopify'): void {
    this.activeFilter.set(filter);
  }

  async refreshOrders(): Promise<void> {
    const store = this.activeStore();
    if (store?.id) {
      await this.analytics.loadStoreOrders(store.id);
      await this.analytics.loadStoreMetrics(store.id);
    }
  }
}
