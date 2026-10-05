import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  NavigationStart,
  NavigationEnd,
  NavigationCancel,
  NavigationError
} from '@angular/router';
import {
  IonContent,
  IonIcon,
  AlertController,
  ToastController
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  gridOutline,
  sparklesOutline,
  trendingUpOutline,
  layersOutline,
  settingsOutline,
  menuOutline,
  sunnyOutline,
  moonOutline,
  notificationsOutline,
  logOutOutline,
  closeOutline,
  cubeOutline,
  syncOutline,
  shieldCheckmarkOutline,
  bagHandleOutline,
  storefrontOutline,
  chevronDownOutline,
  addOutline,
  checkmarkOutline,
  trashOutline,
  globeOutline,
  swapHorizontalOutline,
  receiptOutline
} from 'ionicons/icons';
import { AuthService, User } from '../../core/services/auth.service';
import { StoreService } from '../../core/services/store.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { Store } from '../../core/models/store.models';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IonContent,
    IonIcon
  ]
})
export class DashboardPage implements OnInit {
  user: User | null = null;
  isSidebarOpenMobile = false;
  notificationCount = 3;
  showNotificationsModal = false;
  showStoreSwitcher = false;
  showHeaderStoreSwitcher = false;
  showSidebarStoreSwitcher = false;
  currentRoute = '';
  isNavigating = false;
  titleAnimate = false;

  constructor(
    public authService: AuthService,
    public storeService: StoreService,
    public analytics: AnalyticsService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    addIcons({
      gridOutline,
      sparklesOutline,
      trendingUpOutline,
      layersOutline,
      settingsOutline,
      menuOutline,
      sunnyOutline,
      moonOutline,
      notificationsOutline,
      logOutOutline,
      closeOutline,
      cubeOutline,
      syncOutline,
      shieldCheckmarkOutline,
      bagHandleOutline,
      storefrontOutline,
      chevronDownOutline,
      addOutline,
      checkmarkOutline,
      trashOutline,
      globeOutline,
      swapHorizontalOutline,
      receiptOutline
    });

    this.currentRoute = this.router.url;
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.isNavigating = true;
      } else if (event instanceof NavigationEnd) {
        this.currentRoute = event.urlAfterRedirects;
        this.isSidebarOpenMobile = false;
        this.isNavigating = false;
        this.showHeaderStoreSwitcher = false;
        this.showSidebarStoreSwitcher = false;

        // Trigger title crossfade animation
        this.titleAnimate = true;
        setTimeout(() => {
          this.titleAnimate = false;
        }, 360);

        // Smoothly scroll content container to top
        const scrollContainer = document.querySelector('.content-scroll-container');
        if (scrollContainer) {
          scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.isNavigating = false;
      }
    });
  }

  ngOnInit(): void {
    this.user = this.authService.currentUser();
    if (!this.user) {
      this.user = {
        id: 'guest',
        name: 'Alex Morgan',
        email: 'demo@example.com',
        role: 'Growth & E-Commerce Lead',
        company: 'DB Technology'
      };
    }
  }

  get currentTitle(): string {
    if (this.currentRoute.includes('catalog')) {
      return 'Store Products Catalog';
    }
    if (this.currentRoute.includes('integrations')) {
      return 'Data Integrations & Pakistani COD Hub';
    }
    if (this.currentRoute.includes('overview')) {
      return 'Product Analytics Overview';
    }
    if (this.currentRoute.includes('ai-analytics')) {
      return 'AI Predictive Analytics';
    }
    if (this.currentRoute.includes('growth-deck')) {
      return 'Product Growth Deck';
    }
    if (this.currentRoute.includes('settings')) {
      return 'Platform & Store Settings';
    }
    return 'E-Commerce Growth Engine';
  }

  toggleMobileSidebar(): void {
    this.isSidebarOpenMobile = !this.isSidebarOpenMobile;
  }

  toggleNotifications(): void {
    this.showNotificationsModal = !this.showNotificationsModal;
    if (this.showNotificationsModal) {
      this.notificationCount = 0;
      this.showHeaderStoreSwitcher = false;
    }
  }

  toggleHeaderStoreSwitcher(e?: Event): void {
    if (e) e.stopPropagation();
    this.showHeaderStoreSwitcher = !this.showHeaderStoreSwitcher;
    if (this.showHeaderStoreSwitcher) {
      this.showSidebarStoreSwitcher = false;
      this.showStoreSwitcher = false;
      this.showNotificationsModal = false;
    }
  }

  toggleSidebarStoreSwitcher(e?: Event): void {
    if (e) e.stopPropagation();
    this.showSidebarStoreSwitcher = !this.showSidebarStoreSwitcher;
    this.showStoreSwitcher = this.showSidebarStoreSwitcher;
    if (this.showSidebarStoreSwitcher) {
      this.showHeaderStoreSwitcher = false;
    }
  }

  toggleStoreSwitcher(): void {
    this.toggleSidebarStoreSwitcher();
  }

  async selectStore(store: Store): Promise<void> {
    this.storeService.setActiveStore(store);
    this.showHeaderStoreSwitcher = false;
    this.showSidebarStoreSwitcher = false;
    this.showStoreSwitcher = false;

    const toast = await this.toastCtrl.create({
      message: `Switched to "${store.name}" (${store.domain})`,
      duration: 2200,
      position: 'top',
      color: 'primary'
    });
    await toast.present();
  }

  getStoreInitials(name: string): string {
    if (!name) return 'ST';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  async openCreateStoreModal(): Promise<void> {
    this.showHeaderStoreSwitcher = false;
    this.showSidebarStoreSwitcher = false;
    this.showStoreSwitcher = false;

    const alert = await this.alertCtrl.create({
      header: '🏪 Add New Store',
      subHeader: 'Create an isolated store workspace with its own catalog, ads & courier metrics.',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Store Name (e.g. Urban Kicks)',
        },
        {
          name: 'domain',
          type: 'text',
          placeholder: 'Domain (e.g. urbankicks.myshopify.com)',
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Create Store',
          handler: async (data) => {
            if (!data.name || !data.name.trim()) {
              const toast = await this.toastCtrl.create({
                message: 'Please provide a valid store name.',
                duration: 2500,
                color: 'warning',
                position: 'top'
              });
              await toast.present();
              return false;
            }

            const res = await this.storeService.createStore({
              name: data.name.trim(),
              domain: data.domain?.trim(),
              platform: 'Shopify',
              currency: 'PKR'
            });

            const toast = await this.toastCtrl.create({
              message: res.success ? `🎉 ${res.message}` : `❌ ${res.message}`,
              duration: 3000,
              color: res.success ? 'success' : 'danger',
              position: 'top'
            });
            await toast.present();
            return true;
          }
        }
      ]
    });

    await alert.present();
  }

  async handleLogout(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to end your session?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Log Out',
          role: 'destructive',
          handler: async () => {
            await this.authService.logout();
          }
        }
      ]
    });
    await alert.present();
  }
}
