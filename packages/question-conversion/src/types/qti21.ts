/** A simple choice in a QTI 2.1 choiceInteraction. */
export interface QTI21SimpleChoice {
  identifier: string;
  html: string;
}

/** A simple associable choice in QTI 2.1 matchInteraction. */
export interface QTI21AssociableChoice {
  identifier: string;
  html: string;
  matchMax?: number;
}

/** A gap text in QTI 2.1 gapMatchInteraction. */
export interface QTI21GapText {
  identifier: string;
  text: string;
}

/** An inline choice in QTI 2.1 inlineChoiceInteraction. */
export interface QTI21InlineChoice {
  identifier: string;
  text: string;
}

/** Discriminated union for QTI 2.1 interaction types. */
export type QTI21Interaction =
  | {
      type: 'choiceInteraction';
      responseIdentifier: string;
      maxChoices: number;
      shuffle: boolean;
      choices: QTI21SimpleChoice[];
    }
  | {
      type: 'textEntryInteraction';
      responseIdentifier: string;
      expectedLength?: number;
    }
  | {
      type: 'extendedTextInteraction';
      responseIdentifier: string;
      expectedLength?: number;
      maxStrings?: number;
    }
  | {
      type: 'matchInteraction';
      responseIdentifier: string;
      shuffle: boolean;
      sourceChoices: QTI21AssociableChoice[];
      targetChoices: QTI21AssociableChoice[];
    }
  | {
      type: 'orderInteraction';
      responseIdentifier: string;
      shuffle: boolean;
      choices: QTI21SimpleChoice[];
    }
  | {
      type: 'inlineChoiceInteraction';
      responseIdentifier: string;
      choices: QTI21InlineChoice[];
    };

/** A correct response value from responseDeclaration. */
export interface QTI21CorrectResponse {
  responseIdentifier: string;
  values: string[];
}

/** A parsed QTI 2.1 assessment item. */
export interface QTI21ParsedItem {
  identifier: string;
  title: string;
  promptHtml: string;
  interactions: QTI21Interaction[];
  correctResponses: QTI21CorrectResponse[];
  metadata: Record<string, string>;
}

/** A parsed QTI 2.1 assessment test (collection of items). */
export interface QTI21ParsedAssessment {
  identifier: string;
  title: string;
  items: QTI21ParsedItem[];
}
