import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Moves the element to <body> so a full-screen overlay is positioned against the viewport, not against
 * an ancestor that has a transform or containment (Ionic's content area has both).
 */
@Directive({ selector: '[appPortal]', standalone: true })
export class PortalDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);

  ngOnInit(): void {
    document.body.appendChild(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.el.nativeElement.remove();
  }
}
