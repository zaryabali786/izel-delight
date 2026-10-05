import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  layersOutline,
  syncOutline,
  shieldCheckmarkOutline,
  linkOutline,
  airplaneOutline,
  paperPlaneOutline,
  flashOutline,
  cubeOutline,
  logoWhatsapp,
  chatbubblesOutline,
  keyOutline,
  refreshOutline,
  checkmarkCircleOutline,
  cloudUploadOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StoreService } from '../../core/services/store.service';
import { IntegrationItem } from '../../core/models/analytics.models';

@Component({
  selector: 'app-integrations',
  templateUrl: './integrations.page.html',
  styleUrls: ['./integrations.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class IntegrationsPage {
  integrationFilter: 'all' | 'couriers' | 'ad_store' = 'all';
  syncingMap = signal<Record<string, boolean>>({});
  isSyncingAll = signal<boolean>(false);

  constructor(
    public analytics: AnalyticsService,
    public storeService: StoreService
  ) {
    addIcons({
      layersOutline,
      syncOutline,
      shieldCheckmarkOutline,
      linkOutline,
      airplaneOutline,
      paperPlaneOutline,
      flashOutline,
      cubeOutline,
      logoWhatsapp,
      chatbubblesOutline,
      keyOutline,
      refreshOutline,
      checkmarkCircleOutline,
      cloudUploadOutline
    });
  }

  get filteredIntegrations(): IntegrationItem[] {
    const list = this.analytics.integrations();
    if (this.integrationFilter === 'couriers') {
      return list.filter((i) => i.type === 'courier');
    }
    if (this.integrationFilter === 'ad_store') {
      return list.filter((i) => i.type !== 'courier');
    }
    return list;
  }

  getIntegration(id: string): IntegrationItem | undefined {
    return this.analytics.getIntegration(id);
  }

  isItemConnected(id: string): boolean {
    const item = this.analytics.getIntegration(id);
    return item?.status === 'connected';
  }

  isItemSyncing(id: string): boolean {
    return !!this.syncingMap()[id] || this.analytics.getIntegration(id)?.status === 'syncing';
  }

  getIntegrationStatusLabel(id: string): string {
    if (this.isItemSyncing(id)) return 'Syncing...';
    const item = this.analytics.getIntegration(id);
    if (!item) return 'Not Connected';
    return item.status === 'connected' ? 'Connected' : 'Not Connected';
  }

  getBadgeClass(id: string): string {
    if (this.isItemSyncing(id)) return 'badge-syncing-amber';
    return this.isItemConnected(id) ? 'badge-connected' : 'badge-not-connected';
  }

  async syncIntegration(id: string): Promise<void> {
    const item = this.analytics.getIntegration(id);
    if (!item) return;

    this.syncingMap.update((m) => ({ ...m, [id]: true }));
    try {
      await this.analytics.syncIntegration(item);
    } finally {
      this.syncingMap.update((m) => ({ ...m, [id]: false }));
    }
  }

  async syncAll(): Promise<void> {
    this.isSyncingAll.set(true);
    try {
      await this.analytics.syncAllForActiveStore();
    } finally {
      this.isSyncingAll.set(false);
    }
  }

  openConfig(id: string): void {
    const item = this.analytics.getIntegration(id);
    if (item) {
      this.analytics.openIntegrationConfig(item);
    }
  }
}
