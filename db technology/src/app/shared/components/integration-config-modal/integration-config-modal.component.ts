import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  closeOutline,
  linkOutline,
  keyOutline,
  eyeOutline,
  eyeOffOutline,
  informationCircleOutline,
  shieldCheckmarkOutline,
  checkmarkCircleOutline,
  trashOutline,
  syncOutline,
  sparkles,
  openOutline,
  cubeOutline,
  checkmarkOutline,
  warningOutline,
  helpCircleOutline,
  lockClosedOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { IntegrationItem } from '../../../core/models/analytics.models';

@Component({
  selector: 'app-integration-config-modal',
  templateUrl: './integration-config-modal.component.html',
  styleUrls: ['./integration-config-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class IntegrationConfigModalComponent {
  isSaving = false;
  isTesting = false;
  testSuccess = false;
  showSecrets: Record<string, boolean> = {};

  constructor(
    public analytics: AnalyticsService,
    public authService: AuthService
  ) {
    addIcons({
      closeOutline,
      linkOutline,
      keyOutline,
      eyeOutline,
      eyeOffOutline,
      informationCircleOutline,
      shieldCheckmarkOutline,
      checkmarkCircleOutline,
      trashOutline,
      syncOutline,
      sparkles,
      openOutline,
      cubeOutline,
      checkmarkOutline,
      warningOutline,
      helpCircleOutline,
      lockClosedOutline
    });
  }

  toggleSecret(fieldId: string): void {
    this.showSecrets[fieldId] = !this.showSecrets[fieldId];
  }

  isSecretVisible(fieldId: string): boolean {
    return !!this.showSecrets[fieldId];
  }

  closeModal(): void {
    if (this.isSaving) return;
    this.testSuccess = false;
    this.analytics.closeIntegrationConfig();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('integration-modal-overlay')) {
      this.closeModal();
    }
  }

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  async testConnection(): Promise<void> {
    const config = this.analytics.activeConfigData();
    if (!config) return;

    this.isTesting = true;
    this.testSuccess = false;

    // Simulate authentic API ping verification against developer endpoint
    setTimeout(() => {
      this.isTesting = false;
      this.testSuccess = true;
      setTimeout(() => {
        this.testSuccess = false;
      }, 4000);
    }, 900);
  }

  async saveConfiguration(): Promise<void> {
    const integration = this.analytics.activeConfigIntegration();
    const config = this.analytics.activeConfigData();
    if (!integration || !config) return;

    this.isSaving = true;

    // Simulate saving credentials and verifying handshake
    setTimeout(async () => {
      this.isSaving = false;
      await this.analytics.saveIntegrationConfig(integration, config.fields);
    }, 700);
  }

  async disconnectService(): Promise<void> {
    const integration = this.analytics.activeConfigIntegration();
    if (!integration) return;

    if (confirm(`Are you sure you want to disconnect ${integration.name}? Live data sync and automated tracking webhooks will be paused.`)) {
      await this.analytics.disconnectIntegration(integration);
    }
  }
}
