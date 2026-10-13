import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { directoryPerson, hasDifferentAddress, personAddress, personIssueGroup, personName, preparedPerson, siteAddressReady } from '../src/components/applications/client-review';
import { scoreClientMatch } from '../src/server/services/application-draft-matching.service';
import ClientApplicantReview from '../src/components/applications/ClientApplicantReview';
import { applicationDraftReviewSchema, type PreparedApplicationDraft } from '../src/lib/validation/application-draft';

const person = { clientType: 'INDIVIDUAL' as const, displayName: 'Anna Campbell', title: 'Ms', firstName: 'Anna', lastName: 'Campbell', companyName: null,
  email: 'anna@example.test', phone: null, buildingNumber: '147', addressLine1: 'High Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom' };
const site = { buildingNumber: '147', addressLine1: 'High Street', addressLine2: null, townCity: 'Glasgow', postcode: 'G1 1AA', country: 'United Kingdom', localAuthority: 'Glasgow City Council' };
assert.equal(siteAddressReady(site), true);
for (const key of ['buildingNumber','addressLine1','townCity','postcode']) assert.equal(siteAddressReady({ ...site, [key]: ' ' }), false, `${key} must be present before copying`);
assert.equal(hasDifferentAddress(person, site), false);
assert.equal(hasDifferentAddress({ ...person, buildingNumber: '148' }, site), true, 'existing draft address needs explicit replacement confirmation');
assert.equal(personAddress(person), '147 High Street, Glasgow, G1 1AA');
assert.equal(personName({ ...person, displayName: null }), 'Anna Campbell');
assert.equal(personIssueGroup('applicant.email'), 'contact');
assert.equal(personIssueGroup('client.postcode'), 'address');
assert.equal(personIssueGroup('client.companyName'), 'identity');
const record = { ...person, id: 'existing', name: 'Anna Campbell', email: null, addressLine1: null, address: 'Historic Street' };
assert.equal(directoryPerson(record).email, null, 'directory selection must not invent a missing contact');
assert.equal(directoryPerson(record).addressLine1, 'Historic Street', 'legacy directory address is still displayed');
const partial = { client: { name: { value: 'Anna Campbell' }, email: { value: null } } } as unknown as PreparedApplicationDraft;
assert.equal(preparedPerson(partial).displayName, 'Anna Campbell');
assert.equal(preparedPerson(partial).email, null);
assert.equal(preparedPerson(partial).postcode, null);
assert.equal(preparedPerson(partial).country, null, 'UI mapping does not assume missing source details');
assert.equal(scoreClientMatch({ ...record, firstName: 'Alex', name: 'Alex Campbell', postcode: null, address: null, addressLine1: null, phone: null } as Parameters<typeof scoreClientMatch>[0], { lastName: 'Campbell' }), null, 'surname alone never selects a client');

const review = applicationDraftReviewSchema.parse({ selectedApplicationType: 'HOUSEHOLDER_PLANNING', projectMode:'create',existingProjectId:null,project:{name:'Extension',internalReference:null,typeOfWorkKey:null,summary:null},siteMode:'create',existingSiteId:null,site,clientMode:'create',existingClientId:null,client:person,clientAddressSameAsSite:false,applicantDifferentFromClient:false,applicant:person,agent:{practiceName:null,firstName:null,lastName:null,email:null,phone:null,buildingNumber:null,addressLine1:null,addressLine2:null,townCity:null,postcode:null,country:null},application:{description:null,currentUse:null,proposedUse:null,estimatedValue:null,presetKey:null,selectedCertifierPresetId:null},confirmations:{},documents:[] });
const props = {review,prepared:null,issues:[],draftId:'fixture',saveState:'saved' as const,selectionNeedsConfirmation:false,disabled:false,onChange:()=>{},onSelect:()=>{},onRelationship:()=>{},onSiteAddress:()=>{},onRetrySave:async()=>true};
const complete = renderToStaticMarkup(React.createElement(ClientApplicantReview,props));
assert.ok(complete.includes('Anna Campbell') && complete.includes('Same as client'));
assert.ok(!complete.includes('type="email"'), 'complete client starts with a summary, not a full form');
const missing = renderToStaticMarkup(React.createElement(ClientApplicantReview,{...props,review:{...review,client:{...person,email:null,addressLine1:null}},issues:[{key:'client.email',section:'client',label:'Email',message:'Confirm the email.'},{key:'client.addressLine1',section:'client',label:'Address',message:'Confirm the address.'}]}));
assert.ok(missing.includes('type="email"'), 'missing contact opens just the contact editor');
assert.ok(!missing.includes('>Address line 1<'), 'unrelated address fields remain collapsed with a targeted action');
console.log('Client/applicant summary, source mapping, address safeguards and original match behavior passed.');
