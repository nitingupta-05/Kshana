import CustomInput from '@/components/CustomInput';
import { API_ENDPOINTS, apiCall } from '@/config/api';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const { width } = Dimensions.get('window');

const TYPING_TEXTS = [
  "Creating account!",
  "Register yourself.",
  "Setup your profile.",
  "Make new friend too!"
] as const;

const SignupScreen = () => {
  const router = useRouter();
  const colors = useThemeColor(); 

  // --- Typing Animation Logic ---
  const [displayText, setDisplayText] = useState("");
  const [textIndex, setTextIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    if (charIndex < TYPING_TEXTS[textIndex].length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + TYPING_TEXTS[textIndex][charIndex]);
        setCharIndex(prev => prev + 1);
      }, 100);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setDisplayText("");
        setCharIndex(0);
        setTextIndex(prev => (prev + 1) % TYPING_TEXTS.length);
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [charIndex, textIndex]);

  // --- Scroll Logic ---
  const scrollRef = useRef<ScrollView | null>(null);

  const slideToRight = () => {
    scrollRef.current?.scrollTo({ x: width, animated: true });
  };

  const slideToLeft = () => {
    scrollRef.current?.scrollTo({ x: 0, animated: true });
  };

  // --- Form State ---
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    description: '',
    terms: false
  });

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async () => {
    setError("");
    setSuccess("");

    if (!form.email || !form.password || !form.confirmPassword) {
      return setError("Please fill all basic information fields.");
    }

    if (!form.name || !form.description) {
      return setError("Please complete your profile information.");
    }

    if (!form.terms) {
      return setError("Please accept Terms & Conditions.");
    }

    if (form.password !== form.confirmPassword) {
      return setError("Passwords do not match!");
    }

    if (form.password.length < 6) {
      return setError("Password must be at least 6 characters long.");
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(form.email)) {
      return setError("Please enter a valid email address.");
    }

    try {
      setIsSubmitting(true);

      const data = await apiCall(API_ENDPOINTS.REGISTER, "POST", {
        name: form.name,
        email: form.email,
        password: form.password,
        description: form.description
      });

      setSuccess(data.msg || "Registration successful!");
      setTimeout(() => {
        router.replace('/(pages)/login');
      }, 1500);

    } catch (err: any) {
      setError(err.message || "Server connection failed. Please check your network.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.main, { backgroundColor: colors.background}]}>

      {/* Top Image Section */}
      <View style={styles.rightSection}>
        <View style={[styles.design, styles.second, { backgroundColor: colors.primary }]}>
          <Image
            source={require('../../assets/images/login2.png')}
            style={{ width: 300, height: 300, marginTop: 50 }}
            resizeMode="contain"
          />
        </View>
      </View>

      <View style={styles.leftSection}>
        <Text style={[styles.typingText, { color: colors.text } ]}>{displayText}|</Text>

        <ScrollView
          horizontal
          pagingEnabled
          scrollEnabled={false}
          ref={scrollRef}
          showsHorizontalScrollIndicator={false}
        >

          {/* CARD 1 */}
          <View style={styles.card}>
            <View style={styles.innerCard}>
              <CustomInput
                label="Email"
                icon="📧"
                placeholder="email@gmail.com"
                value={form.email}
                onChangeText={(text) => setForm({ ...form, email: text })}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <CustomInput
                label="Password"
                icon="🔓"
                placeholder="enter password"
                secureTextEntry
                value={form.password}
                onChangeText={(text) => setForm({ ...form, password: text })}
              />

              <CustomInput
                label="Confirm Password"
                icon="🔒"
                placeholder="confirm password"
                secureTextEntry
                value={form.confirmPassword}
                onChangeText={(text) => setForm({ ...form, confirmPassword: text })}
              />

              <TouchableOpacity onPress={slideToRight} style={[styles.arrowBtn, { backgroundColor: colors.primary}]}>
                <Text style={styles.arrowText}>➝</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* CARD 2 */}
          <View style={styles.card}>
            <View style={styles.innerCard}>
              <CustomInput
                label="Name"
                icon="✦"
                placeholder="enter your name"
                value={form.name}
                onChangeText={(text) => setForm({ ...form, name: text })}
              />

              <CustomInput
                label="Description"
                icon="⫘"
                placeholder="About yourself"
                value={form.description}
                onChangeText={(text) => setForm({ ...form, description: text })}
                
              />

              <View style={styles.tcRow}>
                <TouchableOpacity
                  style={[styles.checkbox, form.terms && { borderColor: colors.subtext, backgroundColor: colors.primary}]}
                  onPress={() => setForm({ ...form, terms: !form.terms })}
                />
                <Text style={[styles.tcText, { color: colors.text}]}>
                  Accept Terms & conditions to proceed
                </Text>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {success ? <Text style={styles.successText}>{success}</Text> : null}

              <TouchableOpacity
                onPress={handleRegister}
                style={[styles.signupBtn, isSubmitting && styles.signupBtnDisabled, 
                  { backgroundColor: colors.primary}]}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#333" />
                ) : (
                  <Text style={styles.signupBtnText}>Signup</Text>
                )}
              </TouchableOpacity>

              <View style={styles.loginContainer}>
                <Text style={[styles.questionText, { color: colors.subtext}]}>
                  Already have an account?
                </Text>
                <TouchableOpacity onPress={() => router.push('/(pages)/login')}>
                  <Text style={[styles.loginLink]}> Login</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={slideToLeft}
                style={[styles.arrowBtn, styles.arrowLeft, { backgroundColor: colors.primary}]}
              >
                <Text style={styles.arrowText}>➝</Text>
              </TouchableOpacity>
            </View>
          </View>

        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  main: { flex: 1 },

  rightSection: {
    height: '30%',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },

  design: {
    width: 250,
    height: 300,
    borderBottomLeftRadius: 150,
    borderBottomRightRadius: 150,
    justifyContent: 'center',
    alignItems: 'center',
  },

  second: { marginTop: -50 },

  leftSection: { flex: 1, paddingTop: 20 },

  typingText: {
    fontSize: 22,
    fontFamily: 'KshanaFont',
    textAlign: 'center',
    height: 40,
  },

  card: {
    width: width,
  },

  innerCard: {
    width: '90%',
    alignSelf: 'center',
  },

  arrowBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 20,
  },

  arrowLeft: {
    transform: [{ rotate: '180deg' }],
    marginTop: 10,
  },

  arrowText: { fontSize: 24 },

  tcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
  },

  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    marginRight: 10,
  },

  tcText: { 
    fontSize: 12, 
    fontFamily: 'KshanaFont',
  },

  signupBtn: {
    padding: 12,
    borderRadius: 20,
    alignItems: 'center',
    width: '95%',
    alignSelf: 'center',
  },

  signupBtnDisabled: { opacity: 0.6 },

  signupBtnText: {
    fontFamily: 'KshanaFont',
    fontSize: 20,
  },

  errorText: {
    color: 'red',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },

  successText: {
    color: 'green',
    fontSize: 12,
    fontFamily: 'KshanaFont',
    textAlign: 'center',
    marginBottom: 10,
  },

  loginContainer: {
    flexDirection: 'row',
    marginTop: 15,
    justifyContent: 'center',
  },

  questionText: { 
    fontSize: 13,
    fontFamily: 'KshanaFont',
  },

  loginLink: {
    fontSize: 13,
    color: '#007AFF',
  },
});

export default SignupScreen;
