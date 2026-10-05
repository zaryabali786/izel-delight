import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  sparkles,
  sparklesOutline,
  hardwareChipOutline,
  closeOutline,
  addOutline,
  saveOutline,
  bulbOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-ai-prompt-modal',
  templateUrl: './ai-prompt-modal.component.html',
  styleUrls: ['./ai-prompt-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class AiPromptModalComponent {
  isTrainingAi = false;

  promptTemplates = [
    {
      label: '🧵 Fabric & Material',
      text: 'Fabric & Material: 100% fine combed cotton lawn, guaranteed color-fast, pre-shrunk, breathable non-transparent premium fabric.'
    },
    {
      label: '📏 Sizing & Fit Guide',
      text: 'Sizing & Length: Standard ready-to-wear sizing (XS, S, M, L, XL). Semi-relaxed comfortable fit. Kurti/shirt length is 38 inches.'
    },
    {
      label: '🚚 Delivery & COD',
      text: 'Delivery & Shipping: Nationwide Cash on Delivery (COD) within 2 to 3 business days via premier couriers. Parcel inspection available on delivery.'
    },
    {
      label: '🔄 Return & Exchange',
      text: 'Exchange Policy: 7-day hassle-free doorstep exchange guarantee for sizing adjustments or defect replacement. Support team assists promptly.'
    },
    {
      label: '🎁 Promotional Incentive',
      text: 'Promotional Incentive: If customer requests a bundle or volume discount, offer complimentary Free Express Shipping on orders of 2 or more articles.'
    }
  ];

  constructor(
    public analytics: AnalyticsService,
    public authService: AuthService,
    private toastCtrl: ToastController
  ) {
    addIcons({
      sparkles,
      sparklesOutline,
      hardwareChipOutline,
      closeOutline,
      addOutline,
      saveOutline,
      bulbOutline
    });
  }

  appendPromptTemplate(text: string): void {
    const current = this.analytics.aiPromptText().trim();
    if (!current) {
      this.analytics.aiPromptText.set(text);
    } else {
      this.analytics.aiPromptText.set(current + '\n\n' + text);
    }
  }

  clearPrompt(): void {
    this.analytics.aiPromptText.set('');
  }

  closeModal(): void {
    if (this.isTrainingAi) return;
    this.analytics.closeAiPromptModal();
  }

  async saveAiPrompt(): Promise<void> {
    const prod = this.analytics.aiPromptProduct();
    if (!prod) return;

    this.isTrainingAi = true;

    setTimeout(async () => {
      this.isTrainingAi = false;
      this.analytics.updateProductAiPrompt(prod.id, this.analytics.aiPromptText(), {
        autoAdCopy: this.analytics.aiPromptAutoAdCopy(),
        rtoScoring: this.analytics.aiPromptRtoScoring(),
        weight: this.analytics.aiPromptWeight()
      });

      this.analytics.closeAiPromptModal();

      const toast = await this.toastCtrl.create({
        message: `✨ AI Prompt & Knowledge Model trained for "${prod.title}"! Model is now live for automated customer responses and campaign generation.`,
        duration: 3500,
        position: 'top',
        color: 'success',
        icon: 'sparkles'
      });
      await toast.present();
    }, 850);
  }
}
