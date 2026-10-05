import { Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  searchOutline,
  funnelOutline,
  bagHandleOutline,
  syncOutline,
  openOutline,
  chevronBackOutline,
  chevronForwardOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  closeCircleOutline,
  pricetagOutline,
  arrowUpOutline,
  arrowDownOutline,
  cubeOutline,
  trendingUpOutline,
  sparklesOutline,
  sparkles,
  hardwareChipOutline,
  bulbOutline,
  closeOutline,
  saveOutline,
  informationCircleOutline,
  shieldCheckmarkOutline,
  flashOutline,
  copyOutline,
  checkmarkOutline,
  chatbubbleEllipsesOutline,
  layersOutline,
  refreshOutline,
  addOutline,
  logoWhatsapp,
  chatbubblesOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StoreService } from '../../core/services/store.service';
import { ShopifyProduct } from '../../core/models/analytics.models';

@Component({
  selector: 'app-catalog',
  templateUrl: './catalog.page.html',
  styleUrls: ['./catalog.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class CatalogPage implements OnInit, OnDestroy {
  searchQuery = signal<string>('');
  selectedCategory = signal<string>('All');
  selectedStockStatus = signal<string>('all');
  sortBy = signal<'revenue' | 'roas' | 'rto' | 'stock' | 'price'>('revenue');
  sortDirection = signal<'asc' | 'desc'>('desc');

  currentPage = signal<number>(1);
  pageSize = signal<number>(8);
  isSyncing = signal<boolean>(false);

  categories = [
    'All',
    'Casual Pret',
    'Festive Luxury',
    'Semi-Formal',
    'Summer Pret',
    'Winter Couture',
    'Footwear',
    'Bottoms'
  ];

  constructor(
    public analytics: AnalyticsService,
    public storeService: StoreService,
    private toastCtrl: ToastController
  ) {
    addIcons({
      searchOutline,
      funnelOutline,
      bagHandleOutline,
      syncOutline,
      openOutline,
      chevronBackOutline,
      chevronForwardOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      closeCircleOutline,
      pricetagOutline,
      arrowUpOutline,
      arrowDownOutline,
      cubeOutline,
      trendingUpOutline,
      sparklesOutline,
      sparkles,
      hardwareChipOutline,
      bulbOutline,
      closeOutline,
      saveOutline,
      informationCircleOutline,
      shieldCheckmarkOutline,
      flashOutline,
      copyOutline,
      checkmarkOutline,
      chatbubbleEllipsesOutline,
      layersOutline,
      refreshOutline,
      addOutline,
      logoWhatsapp,
      chatbubblesOutline
    });
  }

  ngOnInit(): void {}

  // Filtered products list based on search, category, and stock
  filteredProducts = computed(() => {
    let list = this.analytics.shopifyProducts();
    const query = this.searchQuery().toLowerCase().trim();
    const category = this.selectedCategory();
    const stockStatus = this.selectedStockStatus();
    const sort = this.sortBy();
    const dir = this.sortDirection();

    // 1. Text Search
    if (query) {
      list = list.filter((p) =>
        p.title.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query) ||
        p.barcode.includes(query) ||
        p.category.toLowerCase().includes(query) ||
        p.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // 2. Category Filter
    if (category !== 'All') {
      list = list.filter((p) => p.category === category);
    }

    // 3. Stock Status Filter
    if (stockStatus !== 'all') {
      list = list.filter((p) => p.inventoryStatus === stockStatus);
    }

    // 4. Sorting
    const sorted = [...list].sort((a, b) => {
      let comparison = 0;
      switch (sort) {
        case 'revenue':
          comparison = a.grossRevenue - b.grossRevenue;
          break;
        case 'roas':
          comparison = a.roas - b.roas;
          break;
        case 'rto':
          comparison = a.rtoRate - b.rtoRate;
          break;
        case 'stock':
          comparison = a.inventoryQuantity - b.inventoryQuantity;
          break;
        case 'price':
          comparison = a.price - b.price;
          break;
      }
      return dir === 'desc' ? -comparison : comparison;
    });

    return sorted;
  });

  // Total calculated pages
  totalPages = computed(() => {
    const total = this.filteredProducts().length;
    return Math.max(1, Math.ceil(total / this.pageSize()));
  });

  // Current paginated products subset for current view
  paginatedProducts = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredProducts().slice(start, start + this.pageSize());
  });

  // Summary Metrics
  catalogStats = computed(() => {
    const all = this.analytics.shopifyProducts();
    const totalSkus = all.length;
    const totalRevenue = all.reduce((sum, p) => sum + p.grossRevenue, 0);
    const lowStockCount = all.filter((p) => p.inventoryStatus === 'low_stock').length;
    const avgRoas = (all.reduce((sum, p) => sum + p.roas, 0) / (all.length || 1)).toFixed(2);

    return {
      totalSkus,
      totalRevenue,
      lowStockCount,
      avgRoas
    };
  });

  // Search input handler
  onSearchInput(event: any): void {
    this.searchQuery.set(event.target.value);
    this.currentPage.set(1);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.currentPage.set(1);
  }

  // Category change
  setCategory(category: string): void {
    this.selectedCategory.set(category);
    this.currentPage.set(1);
  }

  // Stock status filter
  setStockStatus(status: string): void {
    this.selectedStockStatus.set(status);
    this.currentPage.set(1);
  }

  // Sorting
  toggleSort(type: 'revenue' | 'roas' | 'rto' | 'stock' | 'price'): void {
    if (this.sortBy() === type) {
      this.sortDirection.set(this.sortDirection() === 'desc' ? 'asc' : 'desc');
    } else {
      this.sortBy.set(type);
      this.sortDirection.set('desc');
    }
    this.currentPage.set(1);
  }

  // Pagination navigation
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.scrollToTop();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
      this.scrollToTop();
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
      this.scrollToTop();
    }
  }

  changePageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  private scrollToTop(): void {
    const scrollContainer = document.querySelector('.content-scroll-container');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Generate numbered pagination items for desktop
  getPageNumbers(): (number | string)[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: (number | string)[] = [];

    if (total <= 5) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (current > 3) {
        pages.push('...');
      }

      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (current < total - 2) {
        pages.push('...');
      }
      pages.push(total);
    }

    return pages;
  }

  // Trigger real Shopify full catalog sync via backend API
  async syncCatalog(): Promise<void> {
    this.isSyncing.set(true);
    try {
      await this.analytics.syncShopifyCatalog();
      const toast = await this.toastCtrl.create({
        message: '🚀 Full catalog sync initiated with Shopify Admin API. Progress streaming via Realtime WebSockets.',
        duration: 3500,
        position: 'top',
        color: 'success',
        icon: 'checkmark-circle-outline'
      });
      await toast.present();
    } catch (err: any) {
      console.warn('[CatalogPage] Sync notice:', err.message);
      const toast = await this.toastCtrl.create({
        message: err.message || 'Connect Shopify credentials in Integrations to sync live catalog.',
        duration: 3500,
        position: 'top',
        color: 'warning'
      });
      await toast.present();
    } finally {
      this.isSyncing.set(false);
    }
  }

  async openShopifyProduct(product: ShopifyProduct): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: `Opening "${product.title}" in Shopify Admin...`,
      duration: 2000,
      position: 'bottom',
      color: 'dark'
    });
    await toast.present();
  }

  // =========================================================================
  // AI Prompt & Model Training Modal Handlers (Root-Level Overlay)
  // =========================================================================
  openAiPromptModal(product: ShopifyProduct): void {
    this.analytics.openAiPromptModal(product);
  }

  closeAiPromptModal(): void {
    this.analytics.closeAiPromptModal();
  }

  openWhatsAppModal(product: ShopifyProduct): void {
    this.analytics.openWhatsAppModal(product);
  }

  ngOnDestroy(): void {
    this.analytics.closeAiPromptModal();
    this.analytics.closeWhatsAppModal();
  }
}
