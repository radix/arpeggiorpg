use std::collections::HashMap;
use std::fmt;
use std::hash;
use std::iter::FromIterator;

use serde::de;
use serde::ser;


/// A trait for fetching the "canonical" key type for a type.
pub trait DeriveKey {
  /// The key type
  type KeyType: hash::Hash + Eq;
  /// Given a value, get the key that should be used to refer to it.
  fn derive_key(&self) -> Self::KeyType;
}

/// A HashMap which uses keys intrinsic to values with the DeriveKey trait.
#[derive(Eq, PartialEq)]
pub struct IndexedHashMap<V: DeriveKey> {
  data: HashMap<<V as DeriveKey>::KeyType, V>,
}

impl<V> Clone for IndexedHashMap<V>
  where V: DeriveKey + Clone,
        <V as DeriveKey>::KeyType: Clone
{
  fn clone(&self) -> Self {
    IndexedHashMap { data: self.data.clone() }
  }
}

impl<V> fmt::Debug for IndexedHashMap<V>
  where V: DeriveKey + fmt::Debug,
        <V as DeriveKey>::KeyType: fmt::Debug
{
  fn fmt(&self, f: &mut fmt::Formatter) -> Result<(), fmt::Error> {
    self.data.fmt(f)
  }
}

impl<V> ser::Serialize for IndexedHashMap<V>
  where V: DeriveKey + ser::Serialize,
        <V as DeriveKey>::KeyType: ser::Serialize
{
  fn serialize<S>(&self, s: S) -> Result<S::Ok, S::Error>
    where S: ser::Serializer
  {
    self.data.serialize(s)
  }
}

impl<V> de::Deserialize for IndexedHashMap<V>
  where V: DeriveKey + de::Deserialize,
        <V as DeriveKey>::KeyType: de::Deserialize
{
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where D: de::Deserializer
  {
    let hm: HashMap<<V as DeriveKey>::KeyType, V> = de::Deserialize::deserialize(deserializer)?;
    Ok(IndexedHashMap { data: hm })
  }
}

impl<V> FromIterator<V> for IndexedHashMap<V>
  where V: DeriveKey
{
  fn from_iter<T>(iter: T) -> Self
    where T: IntoIterator<Item = V>
  {
    IndexedHashMap { data: iter.into_iter().map(|v| (v.derive_key(), v)).collect() }
  }
}

// Deserialize

impl<V: DeriveKey> IndexedHashMap<V> {
  pub fn new() -> IndexedHashMap<V> {
    IndexedHashMap { data: HashMap::new() }
  }

  pub fn insert(&mut self, v: V) -> Option<V> {
    self.data.insert(v.derive_key(), v)
  }

  pub fn get<'a, Q: ?Sized>(&'a self, k: &Q) -> Option<&'a V>
    where <V as DeriveKey>::KeyType: ::std::borrow::Borrow<Q>,
          Q: hash::Hash + Eq
  {
    self.data.get(k)
  }

  pub fn remove(&mut self, k: &<V as DeriveKey>::KeyType) -> Option<V> {
    self.data.remove(k)
  }
  pub fn contains_key<'a>(&'a self, k: &<V as DeriveKey>::KeyType) -> bool {
    self.data.contains_key(k)
  }

  // If your function panics, the item will disappear from the collection.
  // We may want to allow FnMut(&mut V) as the mutator, but this would require the following extra
  // work:
  // - instead of removing/reinserting the item, we'll need to explicitly check if the key has
  //   changed, and update the hashmap if it has
  // - If we want to handle panics without leaving the collection in an inconsistent state, we'll
  //   need to explicitly catch them.
  pub fn mutate<F>(&mut self, k: &<V as DeriveKey>::KeyType, f: F) -> Option<()>
    where F: FnOnce(V) -> V
  {
    match self.data.remove(k) {
      Some(thing) => {
        self.insert(f(thing));
        Some(())
      }
      None => None,
    }
  }
}