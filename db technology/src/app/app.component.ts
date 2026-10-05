import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { AiPromptModalComponent } from './shared/components/ai-prompt-modal/ai-prompt-modal.component';
import { IntegrationConfigModalComponent } from './shared/components/integration-config-modal/integration-config-modal.component';
import { WhatsAppInquiryModalComponent } from './shared/components/whatsapp-inquiry-modal/whatsapp-inquiry-modal.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [
    IonApp,
    IonRouterOutlet,
    AiPromptModalComponent,
    IntegrationConfigModalComponent,
    WhatsAppInquiryModalComponent
  ],
})
export class AppComponent {
  constructor() {}
}
